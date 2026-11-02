#!/usr/bin/env python3
"""
PPT Master - Resident Web Surface

One long-lived local server for every project's runtime state. It is not tied
to any agent: it reads ``<project>/.runtime/`` and renders what is there, so a
crashed or replaced agent changes nothing about the page.

    /                      project list with live state
    /p/<project>           one project's stage timeline, events, and requests
    /p/<project>/req/<id>  one request's full page (confirm / choose / approve)
    /api/projects          JSON list
    /api/projects/<p>      JSON status view
    /api/projects/<p>/events   JSON event tail
    /api/projects/<p>/requests one request list
    /api/projects/<p>/requests/<id>  POST the answer
    /api/events            Server-Sent Events, one stream for the whole page
    /api/shutdown          graceful exit

This server never writes status: answers go through ``agent_bridge`` so the
event log stays the single source of truth.

Usage:
    python3 scripts/webui/server.py
    python3 scripts/webui/server.py --port 8080 --no-browser
    python3 scripts/webui/server.py --daemon
    python3 scripts/webui/server.py --shutdown

Examples:
    python3 scripts/webui/server.py --timeout 0     # never idle-exit
    python3 scripts/webui/server.py --projects-root projects

Dependencies:
    flask>=3.0.0
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from flask import Flask, Response, jsonify, request, send_from_directory  # noqa: E402

import agent_bridge  # noqa: E402
from console_encoding import configure_utf8_stdio  # noqa: E402
from server_common import (  # noqa: E402
    claim_lock,
    find_free_port,
    open_preview_browser,
    plain_request_log,
    popen_detached,
    read_lock,
    release_lock,
)

DEFAULT_PORT = 8080
STARTUP_TIMEOUT = 10
DEFAULT_IDLE_TIMEOUT = 0  # resident by default: the page must outlive the agent

_SLUG_RE = re.compile(r"[A-Za-z0-9._\-一-鿿]+\Z")
_STATIC_DIR = Path(__file__).resolve().parent / "static"

logger = logging.getLogger("webui")


# ---------------------------------------------------------------------------
# Project discovery
# ---------------------------------------------------------------------------


def _resolve_project(projects_root: Path, slug: str) -> Optional[Path]:
    """Resolve one project directory, refusing anything outside the root."""
    if not _SLUG_RE.match(slug or "") or slug in (".", ".."):
        return None
    candidate = (projects_root / slug).resolve()
    try:
        candidate.relative_to(projects_root.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_dir() else None


def list_projects(projects_root: Path) -> list[dict]:
    """Return one summary per project directory, newest activity first."""
    entries: list[dict] = []
    try:
        children = sorted(projects_root.iterdir())
    except OSError:
        return entries
    for child in children:
        if not child.is_dir() or child.name.startswith("."):
            continue
        if not (child / ".runtime").is_dir() and not (child / "svg_output").is_dir():
            continue
        entries.append(summarize_project(child))
    entries.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return entries


def summarize_project(project: Path) -> dict:
    """Build the list row for one project without loading its whole log."""
    paths = agent_bridge.Paths(project)
    view = agent_bridge.effective_state(paths)
    open_requests = [
        item["request"]
        for item in agent_bridge.list_requests(project)
        if item["response"] is None
    ]
    return {
        "slug": project.name,
        "state": view.get("state"),
        "stage": view.get("stage"),
        "stage_label": view.get("stage_label"),
        "stage_index": view.get("stage_index"),
        "progress": view.get("progress"),
        "route": view.get("route"),
        "profile": view.get("profile"),
        "run_id": (view.get("run") or {}).get("run_id"),
        "updated_at": view.get("updated_at"),
        "lease_expires_at": view.get("lease_expires_at"),
        "open_requests": [item["id"] for item in open_requests],
    }


def _events_tail(project: Path, limit: int = 200) -> list[dict]:
    """Return the most recent events, oldest first."""
    events = agent_bridge._iter_events(agent_bridge.Paths(project))
    return events[-limit:]


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app(projects_root: Path, idle_timeout: int = DEFAULT_IDLE_TIMEOUT) -> Flask:
    app = Flask(__name__, static_folder=None)
    app.config.update(
        PROJECTS_ROOT=projects_root.resolve(),
        IDLE_TIMEOUT=idle_timeout,
        LAST_ACTIVITY=time.monotonic(),
        SERVER_PORT=0,
    )
    plain_request_log()

    @app.before_request
    def _touch() -> None:
        app.config["LAST_ACTIVITY"] = time.monotonic()

    @app.get("/")
    def index() -> Response:
        return send_from_directory(_STATIC_DIR, "index.html")

    @app.get("/static/<path:filename>")
    def static_files(filename: str) -> Response:
        return send_from_directory(_STATIC_DIR, filename)

    @app.get("/p/<slug>")
    def project_page(slug: str) -> Response:
        return send_from_directory(_STATIC_DIR, "index.html")

    @app.get("/p/<slug>/req/<req_id>")
    def request_page(slug: str, req_id: str) -> Response:
        return send_from_directory(_STATIC_DIR, "index.html")

    @app.get("/api/health")
    def health() -> Response:
        return jsonify({
            "status": "ok",
            "service": "webui",
            "pid": os.getpid(),
            "projects_root": str(app.config["PROJECTS_ROOT"]),
            "port": app.config.get("SERVER_PORT"),
        })

    @app.post("/api/shutdown")
    def shutdown() -> Response:
        logger.info("shutdown requested")
        threading.Thread(target=_exit_soon, daemon=True).start()
        return jsonify({"status": "ok"})

    @app.get("/api/projects")
    def api_projects() -> Response:
        return jsonify({"projects": list_projects(app.config["PROJECTS_ROOT"])})

    @app.get("/api/projects/<slug>")
    def api_project(slug: str) -> Response:
        project = _resolve_project(app.config["PROJECTS_ROOT"], slug)
        if project is None:
            return jsonify({"error": "unknown project"}), 404
        paths = agent_bridge.Paths(project)
        view = agent_bridge.effective_state(paths)
        return jsonify({
            "status": view,
            "summary": summarize_project(project),
        })

    @app.get("/api/projects/<slug>/events")
    def api_events(slug: str) -> Response:
        project = _resolve_project(app.config["PROJECTS_ROOT"], slug)
        if project is None:
            return jsonify({"error": "unknown project"}), 404
        limit = min(int(request.args.get("limit", "200")), 2000)
        return jsonify({"events": _events_tail(project, limit)})

    @app.get("/api/projects/<slug>/requests")
    def api_requests(slug: str) -> Response:
        project = _resolve_project(app.config["PROJECTS_ROOT"], slug)
        if project is None:
            return jsonify({"error": "unknown project"}), 404
        return jsonify({"requests": agent_bridge.list_requests(project)})

    @app.post("/api/projects/<slug>/requests/<req_id>")
    def api_answer(slug: str, req_id: str) -> Response:
        project = _resolve_project(app.config["PROJECTS_ROOT"], slug)
        if project is None:
            return jsonify({"error": "unknown project"}), 404
        payload = request.get_json(silent=True) or {}
        status = str(payload.get("status") or "answered")
        choice = payload.get("choice") or []
        if isinstance(choice, str):
            choice = [choice]
        try:
            response = agent_bridge.answer_request(
                project,
                req_id,
                status=status,
                choice=[str(item) for item in choice],
                text=payload.get("text"),
                by="user",
                surface="web",
            )
        except agent_bridge.BridgeError as exc:
            code = 409 if exc.code == agent_bridge.EXIT_VERSION_CONFLICT else 400
            return jsonify({"error": str(exc)}), code
        return jsonify({"response": response})

    @app.get("/api/events")
    def api_stream() -> Response:
        """Stream a coarse change signal; the client refetches page data.

        The stream deliberately carries no payload: the file tree is the
        source of truth, and re-reading it keeps a reconnect and a first load
        on exactly the same code path.
        """

        def generate():
            last = ""
            while True:
                signature = _root_signature(app.config["PROJECTS_ROOT"])
                if signature != last:
                    last = signature
                    yield f"event: change\ndata: {signature}\n\n"
                else:
                    yield ": keepalive\n\n"
                time.sleep(1.5)

        return Response(generate(), mimetype="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        })

    if idle_timeout > 0:
        threading.Thread(
            target=_idle_watchdog,
            args=(app, idle_timeout),
            daemon=True,
        ).start()

    return app


def _root_signature(projects_root: Path) -> str:
    """Cheap fingerprint of every runtime directory's mtime and size."""
    parts: list[str] = []
    try:
        for child in sorted(projects_root.iterdir()):
            runtime = child / ".runtime"
            if not runtime.is_dir():
                continue
            try:
                status = runtime / agent_bridge.STATUS_NAME
                events = runtime / agent_bridge.EVENTS_NAME
                events_size = events.stat().st_size if events.exists() else 0
                status_mtime = int(status.stat().st_mtime * 1000) if status.exists() else 0
                inbox = runtime / agent_bridge.INBOX_DIRNAME
                inbox_count = len(list(inbox.glob("*.json"))) if inbox.is_dir() else 0
            except OSError:
                continue
            parts.append(f"{child.name}:{status_mtime}:{events_size}:{inbox_count}")
    except OSError:
        return ""
    return "|".join(parts)


def _idle_watchdog(app: Flask, idle_timeout: int) -> None:
    while True:
        time.sleep(5)
        elapsed = time.monotonic() - app.config["LAST_ACTIVITY"]
        if elapsed > idle_timeout:
            logger.info("idle for %ds, shutting down", idle_timeout)
            _exit_soon()
            return


def _exit_soon() -> None:
    time.sleep(0.2)
    os._exit(0)


# ---------------------------------------------------------------------------
# Launcher
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Resident local web surface for agent-bridge runtime state.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port", type=int, help=f"exact port (default: first free from {DEFAULT_PORT})")
    parser.add_argument("--projects-root", default=None, help="directory holding projects (default: <repo>/projects)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    parser.add_argument("--daemon", action="store_true", help="run detached and return")
    parser.add_argument("--shutdown", action="store_true", help="stop a running instance")
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_IDLE_TIMEOUT,
        help=f"idle seconds before exit (default {DEFAULT_IDLE_TIMEOUT} = never)",
    )
    return parser


def _default_projects_root() -> Path:
    return _SCRIPTS_DIR.parents[2] / "projects"


def _lock_file(projects_root: Path) -> Path:
    return projects_root / ".webui" / "lock.json"


def main(argv: Optional[list[str]] = None) -> int:
    configure_utf8_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)
    projects_root = Path(args.projects_root).expanduser().resolve() if args.projects_root else _default_projects_root()
    if not projects_root.is_dir():
        print(f"error: projects root does not exist: {projects_root}", file=sys.stderr)
        return 1
    lock_file = _lock_file(projects_root)
    lock_file.parent.mkdir(parents=True, exist_ok=True)

    if args.shutdown:
        existing = read_lock(lock_file)
        if not existing or not existing.get("port"):
            print("error: no running instance", file=sys.stderr)
            return 1
        url = f"http://127.0.0.1:{existing['port']}/api/shutdown"
        req = urllib.request.Request(url, data=b"{}", method="POST")
        try:
            urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=3)
        except OSError as exc:
            print(f"error: shutdown request failed: {exc}", file=sys.stderr)
            return 1
        print(json.dumps({"status": "stopped", "port": existing["port"]}))
        return 0

    existing = read_lock(lock_file)
    if existing and existing.get("port"):
        print(f"error: already running at http://127.0.0.1:{existing['port']}", file=sys.stderr)
        return 1

    if args.daemon:
        port = args.port if args.port else find_free_port(DEFAULT_PORT)
        child_args = [
            sys.executable,
            str(Path(__file__).resolve()),
            "--no-browser",
            "--port",
            str(port),
            "--projects-root",
            str(projects_root),
            "--timeout",
            str(args.timeout),
        ]
        log_path = lock_file.with_name("server.log")
        with open(log_path, "w", encoding="utf-8") as log_handle:
            popen_detached(
                child_args,
                logger=logger,
                stdout=log_handle,
                stderr=log_handle,
                stdin=subprocess_devnull(),
            )
        url = f"http://127.0.0.1:{port}"
        if _wait_for_health(url):
            claim_lock(lock_file, port)
            print(json.dumps({"status": "ready", "url": url, "port": port}))
            if not args.no_browser:
                open_preview_browser(url, logger)
            return 0
        print(f"error: server did not become ready; see {log_path}", file=sys.stderr)
        return 1

    port = args.port if args.port else find_free_port(DEFAULT_PORT)
    app = create_app(projects_root, idle_timeout=args.timeout)
    app.config["SERVER_PORT"] = port
    claim_lock(lock_file, port)
    url = f"http://127.0.0.1:{port}"
    print(json.dumps({"status": "serving", "url": url, "port": port}))
    if not args.no_browser:
        open_preview_browser(url, logger)
    try:
        app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
    finally:
        release_lock(lock_file)
    return 0


def subprocess_devnull():
    import subprocess

    return subprocess.DEVNULL


def _wait_for_health(url: str, timeout: int = STARTUP_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.time() < deadline:
        try:
            with opener.open(f"{url}/api/health", timeout=1) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload.get("service") == "webui":
                return True
        except (OSError, ValueError):
            time.sleep(0.2)
    return False


if __name__ == "__main__":
    raise SystemExit(main())
