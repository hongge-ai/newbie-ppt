#!/usr/bin/env python3
"""
PPT Master - Eval Score

Score one finished project against a task's pass conditions. Reads
`expect.json` from the task directory, runs the SVG quality checker at the
declared stage, and reports a pass/fail verdict per condition plus the raw
numbers, so two passing runs can still be compared on cost.

A task stores inputs and conditions, never an expected deck: the verdict is
behavioural (what the checker finds), not a comparison against a reference.

Maintainer tool. Model runs stay manual and out of CI; this command only scores
a project that already exists.

Usage:
    python3 scripts/eval_score.py <task_dir> <project_path> [--json]
    python3 scripts/eval_score.py evals/tasks/control-broken-page <project>  # must fail

Examples:
    python3 skills/ppt-master/scripts/eval_score.py evals/tasks/free-design-12 projects/demo_20261031
    python3 skills/ppt-master/scripts/eval_score.py evals/tasks/free-design-12 projects/demo_20261031 --json

Dependencies:
    None (standard library only); delegates to svg_quality_checker.py.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402

CHECKER = _SCRIPTS_DIR / 'svg_quality_checker.py'
EXPECT_NAME = 'expect.json'
_SLIDE_PART_RE = re.compile(r'ppt/slides/slide\d+\.xml')


@dataclass(frozen=True)
class Condition:
    """One named pass condition, evaluated against the checker numbers."""

    name: str
    passed: bool
    actual: Any
    expected: str


def load_expect(task_dir: Path) -> dict[str, Any]:
    """Read and sanity-check a task's `expect.json`."""
    path = task_dir / EXPECT_NAME
    if not path.is_file():
        raise SystemExit(f'[ERROR] {EXPECT_NAME} not found in {task_dir}')
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise SystemExit(f'[ERROR] {path} is not valid JSON: {exc}') from exc
    if not isinstance(payload, dict):
        raise SystemExit(f'[ERROR] {path} must contain a JSON object')
    expectation = payload.get('expectation', 'pass')
    if expectation not in ('pass', 'fail'):
        raise SystemExit(
            f"[ERROR] {path}: expectation must be 'pass' or 'fail', got {expectation!r}"
        )
    return payload


def run_checker(project: Path, stage: str) -> dict[str, Any]:
    """Run the checker at one stage and return its JSON report."""
    if not project.is_dir():
        raise SystemExit(f'[ERROR] project not found: {project}')
    with tempfile.TemporaryDirectory() as scratch:
        report_path = Path(scratch) / 'report.json'
        result = subprocess.run(
            [
                sys.executable,
                str(CHECKER),
                str(project),
                # The route runs every gate with this flag; scoring without it
                # would pass a project the real pipeline would have failed.
                '--canonical-authoring',
                '--stage',
                stage,
                '--json',
                '--json-output',
                str(report_path),
            ],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
        )
        if not report_path.is_file():
            raise SystemExit(
                '[ERROR] checker produced no JSON report\n'
                + (result.stdout or '')
                + (result.stderr or '')
            )
        return json.loads(report_path.read_text(encoding='utf-8'))


def numbers_from(report: dict[str, Any], project: Path | None = None) -> dict[str, int]:
    """Pull the four checker numbers, plus the export delivery when asked."""
    summary = report.get('summary') or {}
    categories = report.get('categories') or {}
    blocking = categories.get('blocking') or {}
    numbers = {
        'pages': int(summary.get('total') or 0),
        'failed_pages': int(summary.get('errors') or 0),
        'warnings': int(summary.get('warnings') or 0),
        'blocking': int(blocking.get('count') or 0),
        'exports': 0,
        'slides': 0,
    }
    if project is not None:
        exports = sorted(
            (project / 'exports').glob('*.pptx'),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        numbers['exports'] = len(exports)
        if exports:
            numbers['slides'] = count_slides(exports[0])
    return numbers


def count_slides(pptx: Path) -> int:
    """Count slide XML parts without loading the file through python-pptx."""
    try:
        with zipfile.ZipFile(pptx) as archive:
            return sum(
                1
                for name in archive.namelist()
                if _SLIDE_PART_RE.fullmatch(name)
            )
    except (OSError, zipfile.BadZipFile):
        return 0


def evaluate(expect: dict[str, Any], numbers: dict[str, int]) -> list[Condition]:
    """Build the condition list for one expectation file."""
    conditions: list[Condition] = []
    if expect.get('expectation', 'pass') == 'fail':
        floor = int(expect.get('min_blocking', 1))
        conditions.append(
            Condition(
                'blocking_found',
                numbers['blocking'] >= floor,
                numbers['blocking'],
                f'>={floor}',
            )
        )
        return conditions
    if 'max_blocking' in expect:
        limit = int(expect['max_blocking'])
        conditions.append(
            Condition('blocking', numbers['blocking'] <= limit, numbers['blocking'], f'<={limit}')
        )
    if 'max_failed_pages' in expect:
        limit = int(expect['max_failed_pages'])
        conditions.append(
            Condition(
                'failed_pages',
                numbers['failed_pages'] <= limit,
                numbers['failed_pages'],
                f'<={limit}',
            )
        )
    page_range = expect.get('pages') or {}
    if page_range:
        low = int(page_range.get('min', 0))
        high = int(page_range.get('max', 10**9))
        conditions.append(
            Condition('pages', low <= numbers['pages'] <= high, numbers['pages'], f'{low}-{high}')
        )
    if expect.get('require_export'):
        conditions.append(
            Condition(
                'export',
                numbers['exports'] >= 1,
                numbers['exports'],
                '>=1 deck in exports/',
            )
        )
        conditions.append(
            Condition(
                'slides',
                numbers['slides'] == numbers['pages'],
                numbers['slides'],
                f"=={numbers['pages']} authored pages",
            )
        )
    return conditions


def score(task_dir: Path, project: Path) -> dict[str, Any]:
    """Score one project and return the verdict payload."""
    expect = load_expect(task_dir)
    stage = str(expect.get('stage') or 'final')
    report = run_checker(project, stage)
    numbers = numbers_from(report, project)
    conditions = evaluate(expect, numbers)
    return {
        'task': task_dir.name,
        'project': str(project),
        'stage': stage,
        'expectation': expect.get('expectation', 'pass'),
        'passed': all(condition.passed for condition in conditions),
        'conditions': [
            {
                'name': condition.name,
                'passed': condition.passed,
                'actual': condition.actual,
                'expected': condition.expected,
            }
            for condition in conditions
        ],
        'numbers': numbers,
    }


def render(verdict: dict[str, Any]) -> str:
    """Render the human summary."""
    status = 'PASS' if verdict['passed'] else 'FAIL'
    lines = [
        f"[EVAL] {verdict['task']} -> {status}",
        f"  expectation {verdict['expectation']} | stage {verdict['stage']}",
    ]
    for condition in verdict['conditions']:
        mark = 'ok  ' if condition['passed'] else 'FAIL'
        lines.append(
            f"  {mark} {condition['name']:14s} {condition['actual']!s:>6} "
            f"(expected {condition['expected']})"
        )
    numbers = verdict['numbers']
    lines.append(
        f"  pages {numbers['pages']} | failed_pages {numbers['failed_pages']} | "
        f"blocking {numbers['blocking']} | warnings {numbers['warnings']}"
    )
    return '\n'.join(lines) + '\n'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Score one project against a task\'s pass conditions.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('task', type=Path, help='Task directory containing expect.json')
    parser.add_argument('project', type=Path, help='Finished project directory')
    parser.add_argument('--json', action='store_true', help='Emit the verdict as JSON')
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    verdict = score(args.task, args.project)
    if args.json:
        sys.stdout.write(json.dumps(verdict, ensure_ascii=False, indent=2) + '\n')
    else:
        sys.stdout.write(render(verdict))
    return 0 if verdict['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
