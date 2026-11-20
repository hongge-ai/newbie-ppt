#!/usr/bin/env python3
"""
PPT Master - Confirmation Wait

Block until the browser confirms one stage (or submits an outline revision
batch), then exit. The workbench serves outline review, template selection, and
Stage-2 plan review in one resident process, so waiting needs no server of its
own: this reads the receipt files those views write.

Usage:
    python3 scripts/confirm_ui/wait.py <project_path> --stage outline
    python3 scripts/confirm_ui/wait.py <project_path> --stage stage1

Examples:
    python3 scripts/confirm_ui/wait.py projects/demo_ppt169_20261031 --stage outline
    python3 scripts/confirm_ui/wait.py projects/demo_ppt169_20261031 --stage outline --publish-revision
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

from agent_bridge import beat as beat_run  # noqa: E402
from confirm_ui.outline_store import (  # noqa: E402
    OUTLINE_FILE_NAME,
    OUTLINE_STATE_NAME,
    get_workbench_stage1_prefs,
    outline_paths,
    publish_outline,
    read_outline_view,
)
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


EXIT_CONFIRMED = 0
EXIT_NOT_READY = 1
EXIT_TIMEOUT = 124
POLL_SECONDS = 0.5
# The bridge lease expires after 60 s; a waiting run must keep it alive or the
# workbench would report the run as interrupted while its human is deciding.
BEAT_SECONDS = 20


def _wait_for_outline(project: Path, timeout: int, publish_revision: bool) -> int:
    md_path, state_path = outline_paths(project)
    if not md_path.is_file():
        print(
            f"error: stage outline is not ready: {OUTLINE_FILE_NAME} not found in {project}",
            file=sys.stderr,
        )
        return EXIT_NOT_READY
    if publish_revision or not state_path.is_file():
        try:
            publish_outline(project)
        except ValueError as exc:
            print(f"error: stage outline is not ready: {exc}", file=sys.stderr)
            return EXIT_NOT_READY

    deadline = None if timeout <= 0 else time.monotonic() + timeout
    last_beat = 0.0
    while True:
        now = time.monotonic()
        if now - last_beat >= BEAT_SECONDS:
            last_beat = now
            try:
                beat_run(project)
            except Exception:
                pass

        view = read_outline_view(project)
        if not view["available"]:
            print(
                f"error: stage outline is not ready: {OUTLINE_FILE_NAME} disappeared",
                file=sys.stderr,
            )
            return EXIT_NOT_READY
        if view["status"] == "revising":
            print(json.dumps({
                "stage": "outline",
                "status": "revising",
                "round": view["round"],
                "pending_revision": view["pending_revision"],
            }, ensure_ascii=False))
            return EXIT_CONFIRMED
        if view["status"] == "confirmed":
            print(json.dumps({
                "stage": "outline",
                "status": "confirmed",
                "round": view["round"],
                "slide_count": view["slide_count"],
                "outline_sha256": view["outline_sha256"],
            }, ensure_ascii=False))
            return EXIT_CONFIRMED

        if deadline is not None and time.monotonic() >= deadline:
            print(
                f"error: timed out waiting for stage=outline; re-check { project / CONFIRM_DIR_NAME / OUTLINE_STATE_NAME }",
                file=sys.stderr,
            )
            return EXIT_TIMEOUT
        time.sleep(POLL_SECONDS)


def wait_for_stage(
    project: Path,
    stage: str = "final",
    timeout: int = 900,
    publish_revision: bool = False,
) -> int:
    """Poll the receipt files until the target stage is confirmed or needs revision."""
    if stage == "outline":
        return _wait_for_outline(project, timeout=timeout, publish_revision=publish_revision)

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
                prefs = get_workbench_stage1_prefs(project)
                print(json.dumps({
                    "stage": stage,
                    "status": "confirmed",
                    "delegate_stage2": prefs["skip_stage2_delegation"] if "skip_stage2_delegation" in prefs else prefs["skip_stage2_review"],
                    "preferred_visual_style": prefs["preferred_visual_style"],
                }))
                return EXIT_CONFIRMED
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
        "--stage", default="final", choices=("outline", "stage1", "stage2", "final"),
        help="Stage to wait for (default: final)",
    )
    parser.add_argument(
        "--publish-revision",
        action="store_true",
        help="Mark a newly written/revised outline.md as ready before waiting (--stage outline)",
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
    return wait_for_stage(
        project,
        stage=args.stage,
        timeout=args.timeout,
        publish_revision=args.publish_revision,
    )


if __name__ == "__main__":
    raise SystemExit(main())
