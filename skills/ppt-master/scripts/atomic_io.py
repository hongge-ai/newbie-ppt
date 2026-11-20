#!/usr/bin/env python3
"""
PPT Master - Atomic File Publication

Every writer here publishes a file by writing a sibling temporary file and
replacing the destination, so a reader never observes a half-written artifact.

On Windows that replacement is not unconditional. ``os.replace`` maps to
``MoveFileEx(MOVEFILE_REPLACE_EXISTING)``, which needs delete access to the
existing destination; real-time antivirus, cloud-sync clients and editor file
watchers open a freshly written file for a few milliseconds and report
``PermissionError`` (WinError 5) to a write that is otherwise correct. The
window repeats because a generation rewrites the same small status file on
every step. This module is the one place that knows about it, so no writer
has to.

Usage:
    from atomic_io import write_json_atomic, write_bytes_atomic

Examples:
    write_json_atomic(project / ".runtime" / "status.json", status)
    write_bytes_atomic(project / "design_spec.md", payload)

Dependencies:
    None (only uses the standard library)
"""

from __future__ import annotations

import json
import os
import stat
import tempfile
import time
from pathlib import Path
from typing import Any


# Five attempts at 60 ms keep the worst case near 0.3 s, well under the 5 s
# budget a lock waiter allows, so a retry never reads as a stalled writer.
REPLACE_ATTEMPTS = 5
REPLACE_DELAY_SECONDS = 0.06


def replace_with_retry(source: Path, target: Path) -> None:
    """Publish ``source`` over ``target``, retrying a transient access denial."""
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(REPLACE_DELAY_SECONDS)


def _sibling_temp(path: Path) -> Path:
    """Return an unused sibling name, unique per process and per call."""
    return path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")


def _discard(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def write_json_atomic(path: Path, payload: Any, *, indent: int = 2) -> None:
    """Write one JSON document so readers only ever see a complete object."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = _sibling_temp(path)
    try:
        data = json.dumps(payload, ensure_ascii=False, indent=indent)
        with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(data)
            handle.write("\n")
        replace_with_retry(temporary, path)
    finally:
        _discard(temporary)


def write_bytes_atomic(path: Path, data: bytes) -> None:
    """Write one byte payload, keeping the destination's mode and durability."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            temporary.chmod(stat.S_IMODE(path.stat().st_mode))
        replace_with_retry(temporary, path)
    finally:
        _discard(temporary)
