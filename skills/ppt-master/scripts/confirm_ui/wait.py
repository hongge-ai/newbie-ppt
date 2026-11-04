#!/usr/bin/env python3
"""
PPT Master - Confirmation Wait

Block until the browser confirms one stage, then exit. The confirmation page is
served by the resident workbench at ``/p/<slug>/confirm/``, so waiting needs no
server of its own: this reads the receipt files that page writes.

Usage:
    python3 scripts/confirm_ui/wait.py <project_path> --stage stage1

Examples:
    python3 scripts/confirm_ui/wait.py projects/demo_ppt169_20261031 --stage stage1
    python3 scripts/confirm_ui/wait.py projects/demo_ppt169_20261031 --stage final --timeout 1800

Dependencies:
    The confirmation module's imports, plus ``agent_bridge`` so a bound run
    keeps its writer lease while a human takes their time on the page.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from confirm_ui.server import (  # noqa: E402
    CONFIRM_DIR_NAME,
    RESULT_NAME,
    TEMPLATE_SELECTION_NAME,
    _active_recommendations_path,
    _fresh_template_restart,
    _read_template_selection,
    _result_stage,
    _stage1_ready_error,
    _stage2_ready_error,
)
from console_encoding import configure_utf8_stdio  # noqa: E402
from agent_bridge import beat as beat_run  # noqa: E402


EXIT_CONFIRMED = 0
EXIT_NOT_READY = 1
EXIT_TIMEOUT = 124
POLL_SECONDS = 0.5
# The bridge lease expires after 60 s; a waiting run must keep it alive or the
# workbench would report the run as interrupted while its human is deciding.
BEAT_SECONDS = 20


def wait_for_stage(project: Path, stage: str = "final", timeout: int = 900) -> int:
    """Poll the receipt files until the target stage is confirmed."""
    confirm_dir = project / CONFIRM_DIR_NAME
    result_file = confirm_dir / RESULT_NAME
    deadline = None if timeout <= 0 else time.monotonic() + timeout
    last_beat = 0.0

    while True:
        now = time.monotonic()
        if now - last_beat >= BEAT_SECONDS:
            last_beat = now
            try:
                beat_run(project)
            except Exception:  # no bound run, expired lease, or read-only: keep waiting
                pass

        if not _fresh_template_restart(confirm_dir) and _result_stage(result_file) == stage:
            if stage == "stage1":
                try:
                    _read_template_selection(confirm_dir / TEMPLATE_SELECTION_NAME)
                except (OSError, json.JSONDecodeError, ValueError) as exc:
                    print(
                        f"error: Stage 1 result has no valid template selection: {exc}",
                        file=sys.stderr,
                    )
                    return EXIT_NOT_READY
            print(json.dumps({"stage": stage, "status": "confirmed"}))
            return EXIT_CONFIRMED

        if stage == "stage1":
            readiness_error = _stage1_ready_error(confirm_dir)
        else:
            readiness_error = _stage2_ready_error(
                project,
                confirm_dir,
                _active_recommendations_path(confirm_dir),
            )
        if readiness_error:
            print(f"error: stage {stage} is not ready: {readiness_error}", file=sys.stderr)
            return EXIT_NOT_READY

        if deadline is not None and time.monotonic() >= deadline:
            print(
                f"error: timed out waiting for stage={stage}; the page may still be "
                f"open — re-check {result_file} before falling back to chat",
                file=sys.stderr,
            )
            return EXIT_TIMEOUT

        time.sleep(POLL_SECONDS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Wait for one confirmation stage written by the workbench page.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project_path", help="Project directory holding confirm_ui/")
    parser.add_argument(
        "--stage", default="final", choices=("stage1", "stage2", "final"),
        help="Stage to wait for (default: final)",
    )
    parser.add_argument(
        "--timeout", type=int, default=900,
        help="Seconds before giving up; 0 waits forever (default: 900)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    project = Path(args.project_path).expanduser().resolve()
    if not project.is_dir():
        print(f"error: not a directory: {project}", file=sys.stderr)
        return EXIT_NOT_READY
    return wait_for_stage(project, stage=args.stage, timeout=args.timeout)


if __name__ == "__main__":
    raise SystemExit(main())
