#!/usr/bin/env python3
"""
PPT Master - Spec Review Hold

Set or clear the spec-review hold through the resident workbench. The review
page lives at ``/p/<slug>/spec/``; this is the only writer-side control the
agent needs, and it needs no server of its own.

Usage:
    python3 scripts/spec_review/hold.py <project_path> on
    python3 scripts/spec_review/hold.py <project_path> off

Examples:
    python3 scripts/spec_review/hold.py projects/demo_ppt169_20261031 on

Dependencies:
    None (standard library only)
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402


def _workbench_port(project: Path) -> int:
    """Read the resident workbench port from its repository-level lock."""
    candidates = [
        project.parent / ".workbench" / "workbench.lock",
        project.parent.parent / "projects" / ".workbench" / "workbench.lock",
    ]
    for lock_file in candidates:
        if not lock_file.is_file():
            continue
        try:
            data = json.loads(lock_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        port = data.get("port")
        if isinstance(port, int) and 0 < port < 65536:
            return port
    raise SystemExit("error: no running workbench found; start workbench/server.py first")


def main(argv: list[str] | None = None) -> int:
    configure_utf8_stdio()
    parser = argparse.ArgumentParser(
        description="Set or clear the spec-review hold through the workbench.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project_path", help="Project directory")
    parser.add_argument("state", choices=("on", "off"), help="Hold state to apply")
    args = parser.parse_args(argv)

    project = Path(args.project_path).expanduser().resolve()
    if not project.is_dir():
        print(f"error: not a directory: {project}", file=sys.stderr)
        return 1
    port = _workbench_port(project)
    url = f"http://127.0.0.1:{port}/p/{project.name}/spec/api/hold"
    payload = json.dumps({"hold": args.state == "on"}).encode("utf-8")
    request = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError) as exc:
        print(f"error: cannot reach the review surface: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"hold": body.get("hold"), "project": project.name}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
