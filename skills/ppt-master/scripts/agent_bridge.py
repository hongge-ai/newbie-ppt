#!/usr/bin/env python3
"""
PPT Master - Agent Bridge

Agent-agnostic runtime protocol for one PPT project. Any agent that can run a
shell command writes state here; any web surface reads the same three files.

The runtime directory ``<project>/.runtime/`` holds:

    status.json    materialized view; rebuilt from the event log, never hand-edited
    events.jsonl   append-only fact log (shards: events.<first>-<last>.jsonl)
    lease.json     writer lease and monotonic fence token
    write.lock/    mkdir-based cross-process lock directory
    inbox/         req-NNNN.json (agent asks) and resp-NNNN.json (user answers)

``events.jsonl`` is the source of truth. ``status.json`` is a projection of it,
so deleting ``.runtime/`` loses history, never deck artifacts.

Usage:
    python3 scripts/agent_bridge.py run start --route generate --profile default
    python3 scripts/agent_bridge.py stage execute --label "绘制页面 0/12"
    python3 scripts/agent_bridge.py progress 7 --total 12
    python3 scripts/agent_bridge.py ask --kind confirm --title "Stage 1" \
        --body-file body.md --options-json options.json --json
    python3 scripts/agent_bridge.py wait 0007 --timeout 590
    python3 scripts/agent_bridge.py answer 0007 --status answered --choice free_design
    python3 scripts/agent_bridge.py show --json
    python3 scripts/agent_bridge.py rebuild

Examples:
    python3 scripts/agent_bridge.py run start --resume
    python3 scripts/agent_bridge.py run start --takeover --reason manual
    python3 scripts/agent_bridge.py run -- svg_quality_checker.py projects/demo
    python3 scripts/agent_bridge.py run end --outcome done

Dependencies:
    None (standard library only)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402
from server_common import process_alive  # noqa: E402

# ---------------------------------------------------------------------------
# Layout and policy constants
# ---------------------------------------------------------------------------

RUNTIME_DIRNAME = ".runtime"
STATUS_NAME = "status.json"
EVENTS_NAME = "events.jsonl"
LEASE_NAME = "lease.json"
INBOX_DIRNAME = "inbox"
LOCK_DIRNAME = "write.lock"
LOCK_OWNER_NAME = "owner.json"

SCHEMA_VERSION = 1
EVENT_SCHEMA_VERSION = 1

LEASE_TTL_SECONDS = 60
HEARTBEAT_INTERVAL_SECONDS = 20
LOCK_WAIT_SECONDS = 5.0
LOCK_POLL_SECONDS = 0.05
LOCK_STALE_SECONDS = 30.0
EVENT_ROTATE_BYTES = 8 * 1024 * 1024
EVENT_MAX_LINE_BYTES = 4000
EVENT_SHARD_KEEP = 20
WAIT_POLL_SECONDS = 0.5
DEFAULT_WAIT_TIMEOUT = 590

# Exit codes are part of the agent-facing contract.
EXIT_OK = 0
EXIT_USAGE = 1
EXIT_WAIT_TIMEOUT = 2
EXIT_LEASE_HELD = 3
EXIT_VERSION_CONFLICT = 4
EXIT_CORRUPT = 5

# Ordered stage tables. Order is the contract: readers compute "how many left"
# from the index difference, so a stage may never be re-entered earlier.
STAGE_TABLES: dict[str, tuple[str, ...]] = {
    "generate": (
        "init",
        "source",
        "template_prep",
        "confirm_stage1",
        "template_install",
        "spec",
        "spec_review",
        "lock",
        "images",
        "execute",
        "finalize",
        "export",
        "done",
    ),
    "create-template": (
        "init",
        "intake",
        "brief",
        "confirm",
        "child_run",
        "assets",
        "review_pptx",
        "register",
        "done",
    ),
    "edit-native": (
        "import",
        "plan",
        "confirm",
        "edit",
        "notes_motion",
        "export",
        "done",
    ),
}

RUN_STATES = ("running", "waiting_user", "interrupted", "failed", "done")
EVENT_TYPES = (
    "run/start",
    "run/heartbeat",
    "run/end",
    "stage/enter",
    "stage/exit",
    "progress",
    "ask/open",
    "ask/answered",
    "ask/superseded",
    "say",
    "error",
    "takeover",
    "service/up",
    "service/down",
)
REQUEST_KINDS = ("confirm", "choice", "text", "approval", "edit")
RESPONSE_STATUSES = ("answered", "declined", "expired", "superseded")


# ---------------------------------------------------------------------------
# Small value helpers
# ---------------------------------------------------------------------------


class BridgeError(Exception):
    """A protocol-level failure carrying the exit code the caller should use."""

    def __init__(self, message: str, code: int = EXIT_USAGE):
        super().__init__(message)
        self.code = code


@dataclass
class Paths:
    """All runtime paths for one project."""

    project: Path

    @property
    def runtime(self) -> Path:
        return self.project / RUNTIME_DIRNAME

    @property
    def status(self) -> Path:
        return self.runtime / STATUS_NAME

    @property
    def events(self) -> Path:
        return self.runtime / EVENTS_NAME

    @property
    def lease(self) -> Path:
        return self.runtime / LEASE_NAME

    @property
    def lock_dir(self) -> Path:
        return self.runtime / LOCK_DIRNAME

    @property
    def inbox(self) -> Path:
        return self.runtime / INBOX_DIRNAME

    def ensure(self) -> None:
        self.runtime.mkdir(parents=True, exist_ok=True)
        self.inbox.mkdir(parents=True, exist_ok=True)


def utc_now() -> datetime:
    """Return the current UTC time."""
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    """Format a datetime the way every runtime file expects."""
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(text: object) -> Optional[datetime]:
    """Parse an ISO-8601 timestamp; return None for missing or malformed values."""
    if not isinstance(text, str) or not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def new_run_id() -> str:
    """Build a sortable, collision-resistant run id."""
    stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    return f"r-{stamp}-{random.randrange(16 ** 4):04x}"


def _write_json_atomic(path: Path, payload: dict) -> None:
    """Write JSON through a sibling temp file so readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    data = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False)
    with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(data)
        handle.write("\n")
    os.replace(tmp, path)


def _read_json(path: Path) -> Optional[dict]:
    """Read a JSON object, returning None when it is absent or unreadable."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------------------
# Cross-process lock
# ---------------------------------------------------------------------------


class FileLock:
    """Serialize every runtime write behind an atomically created directory.

    ``mkdir`` is atomic on NTFS and on POSIX filesystems, unlike ``O_APPEND``
    line writes or advisory file locks whose Windows behaviour differs.

    A holder that dies leaves the directory behind. The next waiter reads
    ``owner.json``: a dead pid, a different host, or an over-age directory all
    mean the lock is abandoned and may be removed.
    """

    def __init__(self, paths: Paths) -> None:
        self.paths = paths
        self.acquired = False

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.release()

    def acquire(self) -> None:
        """Wait for the lock, reclaiming it from a stale owner."""
        self.paths.runtime.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while True:
            try:
                self.paths.lock_dir.mkdir(parents=False)
            except FileExistsError:
                if self._reclaim_if_stale():
                    continue
                if time.monotonic() >= deadline:
                    raise BridgeError(
                        f"runtime lock is held: {self.paths.lock_dir}",
                        EXIT_VERSION_CONFLICT,
                    )
                time.sleep(LOCK_POLL_SECONDS)
                continue
            owner = {
                "pid": os.getpid(),
                "host": socket.gethostname(),
                "acquired_at": iso(utc_now()),
            }
            _write_json_atomic(self.paths.lock_dir / LOCK_OWNER_NAME, owner)
            self.acquired = True
            return

    def release(self) -> None:
        """Remove the lock only while this process still owns it."""
        if not self.acquired:
            return
        owner = _read_json(self.paths.lock_dir / LOCK_OWNER_NAME) or {}
        if owner.get("pid") in (None, os.getpid()):
            try:
                for entry in self.paths.lock_dir.iterdir():
                    entry.unlink(missing_ok=True)
                self.paths.lock_dir.rmdir()
            except OSError:
                pass
        self.acquired = False

    def _reclaim_if_stale(self) -> bool:
        owner_path = self.paths.lock_dir / LOCK_OWNER_NAME
        owner = _read_json(owner_path)
        if owner is None:
            # The directory exists without an owner file: either the owner is
            # between mkdir and the first write, or it died there.
            try:
                age = time.time() - self.paths.lock_dir.stat().st_mtime
            except OSError:
                return False
            if age < LOCK_STALE_SECONDS:
                return False
        else:
            same_host = owner.get("host") == socket.gethostname()
            if same_host and process_alive(owner.get("pid")):
                return False
            acquired_at = parse_iso(owner.get("acquired_at"))
            if acquired_at is not None:
                age = (utc_now() - acquired_at).total_seconds()
                if age < LOCK_STALE_SECONDS and same_host:
                    return False
        try:
            for entry in self.paths.lock_dir.iterdir():
                entry.unlink(missing_ok=True)
            self.paths.lock_dir.rmdir()
        except OSError:
            return False
        return True


# ---------------------------------------------------------------------------
# Event log: read, fold, append
# ---------------------------------------------------------------------------


def _shard_paths(paths: Paths) -> list[Path]:
    """Return event shards in seq order; the active shard sorts last."""
    shards = sorted(paths.runtime.glob("events.*.jsonl"))
    if paths.events.is_file():
        shards.append(paths.events)
    return shards


def _iter_events(paths: Paths) -> list[dict]:
    """Read every shard; a trailing line without a newline is a torn write."""
    events: list[dict] = []
    for shard in _shard_paths(paths):
        try:
            raw = shard.read_bytes()
        except OSError:
            continue
        if raw and not raw.endswith(b"\n"):
            cut = raw.rfind(b"\n")
            raw = raw[: cut + 1] if cut >= 0 else b""
        for line in raw.decode("utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(event, dict) and isinstance(event.get("seq"), int):
                events.append(event)
    events.sort(key=lambda item: item["seq"])
    return events


def _last_seq(paths: Paths) -> int:
    """Return the highest committed seq, or 0 for an empty log."""
    events = _iter_events(paths)
    return events[-1]["seq"] if events else 0


def _blank_status(paths: Paths) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "project": paths.project.name,
        "run": None,
        "route": "generate",
        "profile": "default",
        "stage": None,
        "stage_index": None,
        "stage_label": None,
        "state": "idle",
        "surface": "chat",
        "progress": None,
        "next_action": None,
        "blocking": None,
        "error": None,
        "heartbeat_at": None,
        "lease_expires_at": None,
        "updated_at": None,
        "source_seq": 0,
        "version": 0,
    }


def fold_status(paths: Paths, events: Optional[list[dict]] = None) -> dict:
    """Project the event log into the status view.

    Events from a superseded fence are ignored; only the newest fence is
    authoritative, which is what makes an abandoned agent harmless.
    """
    items = _iter_events(paths) if events is None else events
    status = _blank_status(paths)
    if not items:
        return status

    newest_fence = max(int(item.get("fence") or 0) for item in items)
    live = [item for item in items if int(item.get("fence") or 0) == newest_fence]

    for index, event in enumerate(live):
        kind = event.get("type")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        status["source_seq"] = event["seq"]
        status["updated_at"] = event.get("at")
        if kind == "run/start":
            status["run"] = {
                "run_id": event.get("run_id"),
                "fence": event.get("fence"),
                "started_at": event.get("at"),
            }
            status["route"] = data.get("route") or status["route"]
            status["profile"] = data.get("profile") or status["profile"]
            status["surface"] = data.get("surface") or status["surface"]
            status["error"] = None
            if data.get("resume"):
                # A resumed run keeps the open request valid: the user may
                # still answer it, so the view must not claim to be running.
                status["state"] = "waiting_user" if status.get("blocking") else "running"
            else:
                status["state"] = "running"
                status["progress"] = None
                status["stage"] = None
                status["stage_index"] = None
        elif kind == "run/heartbeat":
            pass
        elif kind == "run/end":
            outcome = data.get("outcome") or "done"
            status["state"] = {
                "done": "done",
                "failed": "failed",
                "aborted": "failed",
            }.get(outcome, "failed")
            status["blocking"] = None
            status["next_action"] = None
        elif kind == "takeover":
            status["state"] = "running"
            status["blocking"] = None
        elif kind == "stage/enter":
            status["stage"] = data.get("stage")
            status["stage_index"] = data.get("index")
            status["stage_label"] = data.get("label") or data.get("stage")
            status["state"] = "running"
        elif kind == "progress":
            status["progress"] = {
                "done": data.get("done"),
                "total": data.get("total"),
                "unit": data.get("unit") or "page",
            }
        elif kind == "ask/open":
            status["blocking"] = {
                "req_id": data.get("req_id"),
                "kind": data.get("kind"),
                "prompt": data.get("prompt"),
            }
            status["state"] = "waiting_user"
        elif kind in ("ask/answered", "ask/superseded"):
            blocking = status.get("blocking")
            if blocking and blocking.get("req_id") == data.get("req_id"):
                status["blocking"] = None
                status["state"] = "running"
        elif kind == "say":
            pass
        elif kind == "error":
            status["error"] = {
                "code": data.get("code"),
                "message": data.get("message"),
                "recover": data.get("recover"),
            }
            status["state"] = "failed"
        elif kind == "service/up":
            pass
        elif kind == "service/down":
            pass

    # `version` is the fold watermark, not an event count: it must grow
    # monotonically for readers that deduplicate by comparing versions.
    status["version"] = status["source_seq"]
    return status


def _read_lease(paths: Paths) -> Optional[dict]:
    return _read_json(paths.lease)


def _write_lease(paths: Paths, lease: dict) -> None:
    _write_json_atomic(paths.lease, lease)


def effective_state(paths: Paths, status: Optional[dict] = None) -> dict:
    """Return the status view with liveness applied.

    ``interrupted`` is never stored: it is derived here, so a viewer that reads
    after the lease expired sees the truth without any writer acting.
    """
    view = dict(status or fold_status(paths))
    lease = _read_lease(paths)
    run = view.get("run") or {}
    expires = parse_iso(lease.get("expires_at")) if lease else None
    live = bool(
        lease
        and run
        and lease.get("run_id") == run.get("run_id")
        and expires is not None
        and utc_now() < expires
    )
    view["lease_expires_at"] = lease.get("expires_at") if lease else None
    view["heartbeat_at"] = lease.get("heartbeat_at") if lease else None
    if view.get("state") in ("running", "waiting_user") and not live:
        view["state"] = "interrupted"
        if view.get("blocking"):
            view["blocking"] = dict(view["blocking"], stale=True)
    return view


def _append_event(
    paths: Paths,
    event_type: str,
    data: Optional[dict] = None,
    *,
    run_id: Optional[str] = None,
    fence: Optional[int] = None,
) -> dict:
    """Append one event line. Callers must already hold the runtime lock."""
    lease = _read_lease(paths) or {}
    seq = _last_seq(paths) + 1
    event = {
        "v": EVENT_SCHEMA_VERSION,
        "seq": seq,
        "at": iso(utc_now()),
        "run_id": run_id if run_id is not None else lease.get("run_id"),
        "fence": fence if fence is not None else int(lease.get("fence") or 0),
        "type": event_type,
        "data": data or {},
    }
    line = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
    if len(line.encode("utf-8")) > EVENT_MAX_LINE_BYTES:
        raise BridgeError(
            f"event line exceeds {EVENT_MAX_LINE_BYTES} bytes; "
            "store long content in the project and reference its path",
            EXIT_USAGE,
        )
    paths.runtime.mkdir(parents=True, exist_ok=True)
    _rotate_if_needed(paths)
    with open(paths.events, "a", encoding="utf-8", newline="\n") as handle:
        handle.write(line)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    return event


def _rotate_if_needed(paths: Paths) -> None:
    """Roll the active shard once it grows past the cap."""
    try:
        size = paths.events.stat().st_size
    except OSError:
        return
    if size < EVENT_ROTATE_BYTES:
        return
    events = _iter_events(paths)
    if not events:
        return
    first, last = events[0]["seq"], events[-1]["seq"]
    target = paths.runtime / f"events.{first:09d}-{last:09d}.jsonl"
    os.replace(paths.events, target)
    _prune_shards(paths)


def _prune_shards(paths: Paths) -> None:
    """Keep the newest EVENT_SHARD_KEEP shards."""
    shards = sorted(paths.runtime.glob("events.*.jsonl"))
    for shard in shards[:-EVENT_SHARD_KEEP]:
        try:
            shard.unlink()
        except OSError:
            pass


def _project_status_lockfree(paths: Paths, extra: list[dict]) -> dict:
    """Fold the log plus not-yet-persisted events and write status.json."""
    events = _iter_events(paths) + list(extra)
    events.sort(key=lambda item: item["seq"])
    status = fold_status(paths, events)
    lease = _read_lease(paths)
    if lease:
        status["heartbeat_at"] = lease.get("heartbeat_at")
        status["lease_expires_at"] = lease.get("expires_at")
    _write_json_atomic(paths.status, status)
    return status


# ---------------------------------------------------------------------------
# Lease and writer identity
# ---------------------------------------------------------------------------


def _load_lease(paths: Paths) -> dict:
    lease = _read_lease(paths)
    return lease or {}


def _lease_expired(lease: dict) -> bool:
    expires = parse_iso(lease.get("expires_at"))
    return expires is None or utc_now() >= expires


def _refresh_lease(paths: Paths, lease: dict) -> dict:
    """Extend the lease from now; caller holds the runtime lock."""
    now = utc_now()
    lease["heartbeat_at"] = iso(now)
    lease["expires_at"] = iso(now + timedelta(seconds=LEASE_TTL_SECONDS))
    lease["pid"] = os.getpid()
    lease["host"] = socket.gethostname()
    _write_lease(paths, lease)
    return lease


def _require_writer(paths: Paths, lease: dict) -> dict:
    """Return the lease a mutating command may write under.

    Every subcommand is its own short-lived process, so a pid check cannot
    identify the writer. The lease therefore answers one question only: is a
    run open and recent enough to accept writes? An expired lease means the
    agent that owned it is gone; its late command must resume first rather
    than silently write into whatever run is current.

    Takeover protection for readers comes from the fence carried on every
    event: a takeover bumps it, and the projection ignores older fences.
    """
    if not lease.get("run_id"):
        raise BridgeError(
            "no run is open; start one with `agent_bridge.py run start`",
            EXIT_USAGE,
        )
    if _lease_expired(lease):
        raise BridgeError(
            f"run {lease.get('run_id')} lease expired at {lease.get('expires_at')}; "
            "call `agent_bridge.py run start --resume` (or --takeover) first",
            EXIT_LEASE_HELD,
        )
    return lease


# ---------------------------------------------------------------------------
# Public operations
# ---------------------------------------------------------------------------


def start_run(
    project: Path,
    *,
    route: str = "generate",
    profile: str = "default",
    surface: str = "chat",
    resume: bool = False,
    takeover: bool = False,
    reason: str = "expired",
) -> dict:
    """Open a run, resume the current lease, or take it over."""
    paths = Paths(project)
    paths.ensure()
    if route not in STAGE_TABLES:
        raise BridgeError(f"unknown route: {route}", EXIT_USAGE)
    if surface not in ("chat", "web"):
        raise BridgeError(f"unknown surface: {surface}", EXIT_USAGE)

    with FileLock(paths):
        lease = _load_lease(paths)

        if resume:
            if not lease.get("run_id"):
                raise BridgeError("nothing to resume: no run is open", EXIT_USAGE)
            if not _lease_expired(lease) and lease.get("host") != socket.gethostname():
                raise BridgeError(
                    f"run {lease.get('run_id')} is live on {lease.get('host')}",
                    EXIT_LEASE_HELD,
                )
            run_id = lease["run_id"]
            fence = int(lease.get("fence") or 1)
            new_lease = {
                "run_id": run_id,
                "fence": fence,
                "pid": os.getpid(),
                "host": socket.gethostname(),
                "acquired_at": lease.get("acquired_at") or iso(utc_now()),
                "ttl_seconds": LEASE_TTL_SECONDS,
            }
            _refresh_lease(paths, new_lease)
            event = _append_event(
                paths,
                "run/start",
                {"route": route, "profile": profile, "surface": surface, "resume": True},
                run_id=run_id,
                fence=fence,
            )
            _project_status_lockfree(paths, [event])
            return {"run_id": run_id, "fence": fence, "resumed": True}

        if lease.get("run_id"):
            if not _lease_expired(lease) and not takeover:
                raise BridgeError(
                    f"lease is held by run {lease.get('run_id')} on "
                    f"{lease.get('host')}; pass --takeover to replace it",
                    EXIT_LEASE_HELD,
                )
            if takeover or _lease_expired(lease):
                fence = int(lease.get("fence") or 1) + 1
                superseded = _supersede_open_requests(
                    paths,
                    run_id=lease.get("run_id"),
                    fence=fence,
                    reason=reason,
                )
                takeover_event = _append_event(
                    paths,
                    "takeover",
                    {
                        "prev_run_id": lease.get("run_id"),
                        "prev_fence": int(lease.get("fence") or 1),
                        "reason": reason,
                        "superseded": superseded,
                    },
                    run_id=lease.get("run_id"),
                    fence=fence,
                )
                extra = [takeover_event]
            else:
                raise BridgeError("unreachable lease state", EXIT_LEASE_HELD)
        else:
            fence = 1
            extra = []

        run_id = new_run_id()
        new_lease = {
            "run_id": run_id,
            "fence": fence,
            "pid": os.getpid(),
            "host": socket.gethostname(),
            "acquired_at": iso(utc_now()),
            "ttl_seconds": LEASE_TTL_SECONDS,
        }
        _refresh_lease(paths, new_lease)
        event = _append_event(
            paths,
            "run/start",
            {"route": route, "profile": profile, "surface": surface, "resume": False},
            run_id=run_id,
            fence=fence,
        )
        extra.append(event)
        _project_status_lockfree(paths, extra)
        return {"run_id": run_id, "fence": fence, "resumed": False}


def beat(project: Path) -> dict:
    """Refresh the lease and append a heartbeat event."""
    paths = Paths(project)
    if not paths.runtime.is_dir():
        raise BridgeError("no runtime directory; start a run first", EXIT_USAGE)
    with FileLock(paths):
        lease = _load_lease(paths)
        lease = _require_writer(paths, lease)
        _refresh_lease(paths, lease)
        event = _append_event(paths, "run/heartbeat", {})
        _project_status_lockfree(paths, [event])
        return {"run_id": lease.get("run_id"), "fence": lease.get("fence")}


def enter_stage(
    project: Path,
    stage: str,
    *,
    label: Optional[str] = None,
    takeover: bool = False,
) -> dict:
    """Enter one stage, refusing to move backwards."""
    paths = Paths(project)
    paths.ensure()
    with FileLock(paths):
        lease = _load_lease(paths)
        lease = _require_writer(paths, lease)
        status = fold_status(paths)
        route = status.get("route") or "generate"
        table = STAGE_TABLES.get(route, STAGE_TABLES["generate"])
        if stage not in table:
            raise BridgeError(
                f"unknown stage {stage!r} for route {route}; "
                f"expected one of: {', '.join(table)}",
                EXIT_USAGE,
            )
        index = table.index(stage)
        previous = status.get("stage_index")
        if isinstance(previous, int) and index < previous:
            raise BridgeError(
                f"stage {stage!r} is before the current stage "
                f"{status.get('stage')!r}; stages only move forward",
                EXIT_USAGE,
            )
        events = []
        if status.get("stage") and status.get("stage") != stage:
            events.append(
                _append_event(paths, "stage/exit", {"stage": status.get("stage"), "outcome": "done"})
            )
        events.append(
            _append_event(
                paths,
                "stage/enter",
                {"stage": stage, "index": index, "label": label or stage},
            )
        )
        _project_status_lockfree(paths, events)
        return {"stage": stage, "index": index}


def set_progress(project: Path, done: int, total: Optional[int] = None, unit: str = "page") -> dict:
    """Record the unit-level progress for the current stage."""
    paths = Paths(project)
    with FileLock(paths):
        lease = _require_writer(paths, _load_lease(paths))
        event = _append_event(
            paths,
            "progress",
            {"done": done, "total": total, "unit": unit},
        )
        _project_status_lockfree(paths, [event])
        return {"done": done, "total": total, "unit": unit}


def say(project: Path, text: str, level: str = "info") -> dict:
    """Append one human-facing note."""
    if level not in ("info", "warn"):
        raise BridgeError(f"unknown level: {level}", EXIT_USAGE)
    paths = Paths(project)
    with FileLock(paths):
        lease = _require_writer(paths, _load_lease(paths))
        event = _append_event(paths, "say", {"level": level, "text": text})
        _project_status_lockfree(paths, [event])
        return {"level": level, "text": text}


def fail_run(project: Path, code: str, message: str, recover: Optional[str] = None) -> dict:
    """Mark the run failed with a machine code and a recovery anchor."""
    paths = Paths(project)
    with FileLock(paths):
        lease = _require_writer(paths, _load_lease(paths))
        event = _append_event(
            paths,
            "error",
            {"code": code, "message": message, "recover": recover},
        )
        _project_status_lockfree(paths, [event])
        return {"code": code, "message": message, "recover": recover}


def end_run(project: Path, outcome: str = "done") -> dict:
    """Close the run; the lease is released so a new run can start."""
    if outcome not in ("done", "failed", "aborted"):
        raise BridgeError(f"unknown outcome: {outcome}", EXIT_USAGE)
    paths = Paths(project)
    with FileLock(paths):
        lease = _load_lease(paths)
        lease = _require_writer(paths, lease)
        event = _append_event(paths, "run/end", {"outcome": outcome})
        _project_status_lockfree(paths, [event])
        try:
            paths.lease.unlink(missing_ok=True)
        except OSError:
            pass
        return {"outcome": outcome}


# ---------------------------------------------------------------------------
# Inbox: requests and responses
# ---------------------------------------------------------------------------


def _next_request_id(paths: Paths) -> str:
    """Return the next free request id, never reusing one."""
    highest = 0
    try:
        for entry in paths.inbox.iterdir():
            if entry.name.startswith("req-") and entry.suffix == ".json":
                try:
                    highest = max(highest, int(entry.stem.split("-", 1)[1]))
                except (IndexError, ValueError):
                    continue
    except OSError:
        pass
    return f"{highest + 1:04d}"


def request_path(paths: Paths, req_id: str) -> Path:
    return paths.inbox / f"req-{req_id}.json"


def response_path(paths: Paths, req_id: str) -> Path:
    return paths.inbox / f"resp-{req_id}.json"


def open_request(
    project: Path,
    *,
    kind: str,
    title: str,
    body: str = "",
    options: Optional[list[dict]] = None,
    multi: bool = False,
    allow_text: bool = True,
    url: Optional[str] = None,
    deadline: Optional[str] = None,
    default_if_timeout: Optional[list[str]] = None,
    attachments: Optional[list[str]] = None,
) -> dict:
    """Create one request atomically; it is never modified afterwards."""
    if kind not in REQUEST_KINDS:
        raise BridgeError(
            f"unknown kind {kind!r}; expected one of: {', '.join(REQUEST_KINDS)}",
            EXIT_USAGE,
        )
    paths = Paths(project)
    paths.ensure()
    with FileLock(paths):
        lease = _load_lease(paths)
        lease = _require_writer(paths, lease)
        req_id = _next_request_id(paths)
        request = {
            "schema_version": SCHEMA_VERSION,
            "id": req_id,
            "opened_seq": _last_seq(paths) + 1,
            "run_id": lease.get("run_id"),
            "fence": lease.get("fence"),
            "kind": kind,
            "title": title,
            "body": body,
            "options": options or [],
            "multi": multi,
            "allow_text": allow_text,
            "url": url,
            "deadline": deadline,
            "default_if_timeout": default_if_timeout,
            "attachments": attachments or [],
        }
        try:
            with open(request_path(paths, req_id), "x", encoding="utf-8", newline="\n") as handle:
                json.dump(request, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
        except FileExistsError as exc:
            raise BridgeError(f"request {req_id} already exists", EXIT_VERSION_CONFLICT) from exc
        event = _append_event(
            paths,
            "ask/open",
            {"req_id": req_id, "kind": kind, "prompt": title},
        )
        _project_status_lockfree(paths, [event])
        return request


def list_requests(project: Path) -> list[dict]:
    """Return every request with its current response state, oldest first."""
    paths = Paths(project)
    items: list[dict] = []
    try:
        entries = sorted(paths.inbox.glob("req-*.json"))
    except OSError:
        return items
    for entry in entries:
        request = _read_json(entry)
        if request is None:
            continue
        req_id = str(request.get("id") or entry.stem.split("-", 1)[1])
        response = _read_json(response_path(paths, req_id))
        items.append({"request": request, "response": response})
    return items


def read_response(project: Path, req_id: str) -> Optional[dict]:
    """Return the stored response for a request, or None while unanswered."""
    return _read_json(response_path(Paths(project), req_id))


def answer_request(
    project: Path,
    req_id: str,
    *,
    status: str = "answered",
    choice: Optional[list[str]] = None,
    text: Optional[str] = None,
    by: str = "user",
    surface: str = "web",
) -> dict:
    """Write the one allowed response for a request.

    The file is created exclusively: a second answer is a conflict, not an
    overwrite, so two surfaces can never disagree about what the user chose.
    """
    if status not in RESPONSE_STATUSES:
        raise BridgeError(
            f"unknown response status {status!r}; expected one of: "
            f"{', '.join(RESPONSE_STATUSES)}",
            EXIT_USAGE,
        )
    paths = Paths(project)
    request = _read_json(request_path(paths, req_id))
    if request is None:
        raise BridgeError(f"unknown request: {req_id}", EXIT_USAGE)
    response = {
        "schema_version": SCHEMA_VERSION,
        "id": req_id,
        "req_seq": request.get("opened_seq"),
        "at": iso(utc_now()),
        "status": status,
        "by": by,
        "choice": choice or [],
        "text": text,
        "answered_by_surface": surface,
    }
    try:
        with open(response_path(paths, req_id), "x", encoding="utf-8", newline="\n") as handle:
            json.dump(response, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except FileExistsError as exc:
        existing = read_response(project, req_id) or {}
        raise BridgeError(
            f"request {req_id} was already answered at {existing.get('at')} "
            f"by {existing.get('by')}",
            EXIT_VERSION_CONFLICT,
        ) from exc

    with FileLock(paths):
        events = [
            _append_event(
                paths,
                "ask/answered",
                {
                    "req_id": req_id,
                    "status": status,
                    "choice": response["choice"],
                    "by": by,
                },
            )
        ]
        _project_status_lockfree(paths, events)
    return response


def _supersede_open_requests(
    paths: Paths,
    *,
    run_id: Optional[str],
    fence: int,
    reason: str,
) -> list[str]:
    """Answer every outstanding request as superseded.

    The response file is what a waiting agent polls, so writing it is what
    actually releases the old waiter; a log event alone would leave it polling.
    """
    superseded: list[str] = []
    for item in list_requests(paths.project):
        request = item["request"]
        if item["response"] is not None:
            continue
        if request.get("run_id") != run_id:
            continue
        req_id = str(request.get("id"))
        response = {
            "schema_version": SCHEMA_VERSION,
            "id": req_id,
            "req_seq": request.get("opened_seq"),
            "at": iso(utc_now()),
            "status": "superseded",
            "by": "takeover",
            "choice": [],
            "text": None,
            "answered_by_surface": "agent",
        }
        try:
            with open(response_path(paths, req_id), "x", encoding="utf-8", newline="\n") as handle:
                json.dump(response, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
        except FileExistsError:
            continue
        _append_event(
            paths,
            "ask/superseded",
            {"req_id": req_id, "by": reason, "fence": fence},
        )
        superseded.append(req_id)
    return superseded


def wait_for_response(
    project: Path,
    req_id: str,
    *,
    timeout: Optional[float] = DEFAULT_WAIT_TIMEOUT,
    keep_lease: bool = True,
) -> dict:
    """Poll for a response, refreshing the lease while waiting.

    A timeout is not a failure: the request stays open, so a user who answers
    later is still believed. Exit code 2 tells the agent it may hand back to
    chat without losing the request.
    """
    paths = Paths(project)
    deadline = None if timeout is None or timeout <= 0 else time.monotonic() + timeout
    last_beat = 0.0
    while True:
        response = read_response(project, req_id)
        if response is not None:
            return response
        if keep_lease and time.monotonic() - last_beat >= HEARTBEAT_INTERVAL_SECONDS:
            try:
                beat(project)
            except BridgeError:
                pass
            last_beat = time.monotonic()
        if deadline is not None and time.monotonic() >= deadline:
            raise BridgeError(f"request {req_id} is still unanswered", EXIT_WAIT_TIMEOUT)
        time.sleep(WAIT_POLL_SECONDS)


# ---------------------------------------------------------------------------
# CLI plumbing
# ---------------------------------------------------------------------------


def _print(payload: object) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _project_arg(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not path.is_dir():
        raise BridgeError(f"project directory does not exist: {path}", EXIT_USAGE)
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Agent-agnostic runtime bridge for one PPT project.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="open, resume, take over, or close a run")
    run_sub = run.add_subparsers(dest="action", required=True)
    start = run_sub.add_parser("start", help="open or resume a run")
    start.add_argument("--route", default="generate", choices=sorted(STAGE_TABLES))
    start.add_argument("--profile", default="default")
    start.add_argument("--surface", default="chat", choices=("chat", "web"))
    start.add_argument("--resume", action="store_true", help="reuse the current run id")
    start.add_argument("--takeover", action="store_true", help="replace a live or stale run")
    start.add_argument("--reason", default="expired", choices=("expired", "manual", "host-change"))
    start.add_argument("--project", default=".")
    end = run_sub.add_parser("end", help="close the run")
    end.add_argument("--outcome", default="done", choices=("done", "failed", "aborted"))
    end.add_argument("--project", default=".")
    wrap = run_sub.add_parser(
        "wrap", help="run a child command under a heartbeat",
        epilog="usage: agent_bridge.py run wrap -- [--project DIR] <command ...>",
    )
    wrap.add_argument("argv", nargs=argparse.REMAINDER)

    stage = sub.add_parser("stage", help="enter a stage")
    stage.add_argument("stage")
    stage.add_argument("--label")

    progress = sub.add_parser("progress", help="record unit progress")
    progress.add_argument("done", type=int)
    progress.add_argument("--total", type=int)
    progress.add_argument("--unit", default="page")

    sub.add_parser("beat", help="refresh the writer lease")

    ask = sub.add_parser("ask", help="open one request for the user")
    ask.add_argument("--kind", required=True, choices=REQUEST_KINDS)
    ask.add_argument("--title", required=True)
    ask.add_argument("--body", default="")
    ask.add_argument("--body-file")
    ask.add_argument("--options-json", help="path to a JSON array of options")
    ask.add_argument("--multi", action="store_true")
    ask.add_argument("--no-text", action="store_true")
    ask.add_argument("--url")
    ask.add_argument("--deadline")
    ask.add_argument("--default-if-timeout", nargs="*")
    ask.add_argument("--attachment", action="append", default=[])
    ask.add_argument("--wait", action="store_true", help="wait after opening")
    ask.add_argument("--timeout", type=float, default=DEFAULT_WAIT_TIMEOUT)

    wait = sub.add_parser("wait", help="wait for one request's response")
    wait.add_argument("req_id")
    wait.add_argument("--timeout", type=float, default=DEFAULT_WAIT_TIMEOUT)

    answer = sub.add_parser("answer", help="write the single response for a request")
    answer.add_argument("req_id")
    answer.add_argument("--status", default="answered", choices=RESPONSE_STATUSES)
    answer.add_argument("--choice", action="append", default=[])
    answer.add_argument("--text")
    answer.add_argument("--by", default="user")
    answer.add_argument("--surface", default="cli", choices=("web", "chat", "cli"))

    say_parser = sub.add_parser("say", help="append a note for humans")
    say_parser.add_argument("text")
    say_parser.add_argument("--level", default="info", choices=("info", "warn"))

    fail = sub.add_parser("fail", help="mark the run failed")
    fail.add_argument("--code", required=True)
    fail.add_argument("--message", required=True)
    fail.add_argument("--recover")

    show = sub.add_parser("show", help="print the current status view")
    show.add_argument("--json", action="store_true")

    sub.add_parser("rebuild", help="reproject status.json from the event log")

    project_flag = argparse.ArgumentParser(add_help=False)
    project_flag.add_argument(
        "--project",
        default=".",
        help="project directory (default: current directory)",
    )
    for name, item in sub.choices.items():
        # `run` owns its own subparsers; every other command takes --project.
        if name == "run":
            continue
        item.add_argument("--project", default=".", help="project directory (default: .)")

    return parser


def _read_body(args: argparse.Namespace) -> str:
    if args.body_file:
        return Path(args.body_file).expanduser().read_text(encoding="utf-8")
    return args.body


def _run_wrapped(project: Path, argv: list[str]) -> int:
    """Run a child command while refreshing the lease in the background.

    ``--project DIR`` may appear anywhere in the wrapped argv; it is consumed
    here so it is not forwarded to the child command.
    """
    command: list[str] = []
    index = 0
    while index < len(argv):
        item = argv[index]
        if item == "--project" and index + 1 < len(argv):
            project = _project_arg(argv[index + 1])
            index += 2
            continue
        if item.startswith("--project="):
            project = _project_arg(item.split("=", 1)[1])
            index += 1
            continue
        if item == "--":
            index += 1
            continue
        command.append(item)
        index += 1
    if not command:
        raise BridgeError("run wrap needs a command after --", EXIT_USAGE)
    stop = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(HEARTBEAT_INTERVAL_SECONDS):
            try:
                beat(project)
            except BridgeError:
                return

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        completed = subprocess.run(command, cwd=str(project))
        return completed.returncode
    finally:
        stop.set()


def main(argv: Optional[list[str]] = None) -> int:
    configure_utf8_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            project = _project_arg(args.project)
            if args.action == "start":
                _print(start_run(
                    project,
                    route=args.route,
                    profile=args.profile,
                    surface=args.surface,
                    resume=args.resume,
                    takeover=args.takeover,
                    reason=args.reason,
                ))
                return EXIT_OK
            if args.action == "end":
                _print(end_run(project, args.outcome))
                return EXIT_OK
            if args.action == "wrap":
                return _run_wrapped(project, args.argv)
        if args.command == "stage":
            _print(enter_stage(
                _project_arg(args.project),
                args.stage,
                label=args.label,
            ))
            return EXIT_OK
        if args.command == "progress":
            _print(set_progress(
                _project_arg(args.project),
                args.done,
                args.total,
                args.unit,
            ))
            return EXIT_OK
        if args.command == "beat":
            _print(beat(_project_arg(args.project)))
            return EXIT_OK
        if args.command == "ask":
            options = None
            if args.options_json:
                options = json.loads(
                    Path(args.options_json).expanduser().read_text(encoding="utf-8")
                )
            request = open_request(
                _project_arg(args.project),
                kind=args.kind,
                title=args.title,
                body=_read_body(args),
                options=options,
                multi=args.multi,
                allow_text=not args.no_text,
                url=args.url,
                deadline=args.deadline,
                default_if_timeout=args.default_if_timeout,
                attachments=args.attachment,
            )
            if not args.wait:
                _print(request)
                return EXIT_OK
            response = wait_for_response(
                _project_arg(args.project),
                request["id"],
                timeout=args.timeout,
            )
            _print({"request": request, "response": response})
            return EXIT_OK
        if args.command == "wait":
            response = wait_for_response(
                _project_arg(args.project),
                args.req_id,
                timeout=args.timeout,
            )
            _print(response)
            return EXIT_OK
        if args.command == "answer":
            _print(answer_request(
                _project_arg(args.project),
                args.req_id,
                status=args.status,
                choice=args.choice,
                text=args.text,
                by=args.by,
                surface=args.surface,
            ))
            return EXIT_OK
        if args.command == "say":
            _print(say(Paths(_project_arg(args.project)).project, args.text, args.level))
            return EXIT_OK
        if args.command == "fail":
            _print(fail_run(
                _project_arg(args.project),
                args.code,
                args.message,
                args.recover,
            ))
            return EXIT_OK
        if args.command == "show":
            view = effective_state(Paths(_project_arg(args.project)))
            if args.json:
                _print(view)
            else:
                _print_human(view)
            return EXIT_OK
        if args.command == "rebuild":
            paths = Paths(_project_arg(args.project))
            status = fold_status(paths)
            _write_json_atomic(paths.status, status)
            _print({"rebuilt": True, "source_seq": status["source_seq"]})
            return EXIT_OK
    except BridgeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return exc.code
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_CORRUPT
    parser.print_help()
    return EXIT_USAGE


def _print_human(view: dict) -> None:
    """Print a compact status line for terminal use."""
    stage = view.get("stage") or "-"
    label = view.get("stage_label") or ""
    state = view.get("state")
    progress = view.get("progress")
    parts = [f"stage={stage}", f"state={state}"]
    if progress and progress.get("total"):
        parts.append(f"progress={progress.get('done')}/{progress.get('total')}")
    if label and label != stage:
        parts.append(label)
    blocking = view.get("blocking")
    if blocking:
        parts.append(f"waiting_on={blocking.get('req_id')}")
    print("  ".join(parts))


if __name__ == "__main__":
    raise SystemExit(main())
