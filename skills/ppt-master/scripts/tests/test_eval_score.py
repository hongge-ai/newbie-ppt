#!/usr/bin/env python3
"""Focused tests for the eval scorer's condition logic."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from eval_score import evaluate, load_expect, numbers_from, score  # noqa: E402

REPO_ROOT = SCRIPTS_DIR.parents[2]
CONTROL_TASK = REPO_ROOT / 'evals' / 'tasks' / 'control-broken-page'


def report(*, total: int, errors: int, warnings: int, blocking: int) -> dict[str, object]:
    return {
        'summary': {'total': total, 'errors': errors, 'warnings': warnings, 'passed': 0},
        'categories': {'blocking': {'count': blocking, 'issues': []}},
    }


class NumbersTests(unittest.TestCase):
    def test_numbers_come_from_the_checked_fields(self) -> None:
        numbers = numbers_from(report(total=12, errors=0, warnings=3, blocking=0))

        self.assertEqual(numbers['pages'], 12)
        self.assertEqual(numbers['failed_pages'], 0)
        self.assertEqual(numbers['warnings'], 3)
        self.assertEqual(numbers['blocking'], 0)

    def test_missing_sections_read_as_zero(self) -> None:
        self.assertEqual(
            numbers_from({})['blocking'],
            0,
        )


class ConditionTests(unittest.TestCase):
    def test_a_clean_run_inside_the_page_range_passes(self) -> None:
        expect = {'max_blocking': 0, 'max_failed_pages': 0, 'pages': {'min': 10, 'max': 14}}

        conditions = evaluate(expect, numbers_from(report(total=12, errors=0, warnings=0, blocking=0)))

        self.assertTrue(all(condition.passed for condition in conditions))

    def test_one_blocking_finding_fails_the_run(self) -> None:
        expect = {'max_blocking': 0}

        conditions = evaluate(expect, numbers_from(report(total=12, errors=0, warnings=0, blocking=1)))

        self.assertFalse(conditions[0].passed)

    def test_page_count_outside_the_range_fails(self) -> None:
        expect = {'pages': {'min': 10, 'max': 14}}

        low = evaluate(expect, numbers_from(report(total=9, errors=0, warnings=0, blocking=0)))
        high = evaluate(expect, numbers_from(report(total=15, errors=0, warnings=0, blocking=0)))

        self.assertFalse(low[0].passed)
        self.assertFalse(high[0].passed)

    def test_a_control_task_requires_the_finding(self) -> None:
        expect = {'expectation': 'fail', 'min_blocking': 1}

        broken = evaluate(expect, numbers_from(report(total=1, errors=2, warnings=1, blocking=2)))
        clean = evaluate(expect, numbers_from(report(total=1, errors=0, warnings=0, blocking=0)))

        self.assertTrue(broken[0].passed)
        self.assertFalse(clean[0].passed)


class ExpectFileTests(unittest.TestCase):
    def test_a_missing_expect_file_is_a_setup_error(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            with self.assertRaises(SystemExit):
                load_expect(Path(scratch))

    def test_an_unknown_expectation_is_a_setup_error(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            (Path(scratch) / 'expect.json').write_text(
                json.dumps({'expectation': 'maybe'}), encoding='utf-8'
            )
            with self.assertRaises(SystemExit):
                load_expect(Path(scratch))


@unittest.skipUnless(
    (SCRIPTS_DIR / 'svg_quality_checker.py').is_file(),
    'the checker is required for the end-to-end control',
)
class ControlTaskTests(unittest.TestCase):
    def test_the_shipped_control_task_fails_the_checker(self) -> None:
        verdict = score(CONTROL_TASK, CONTROL_TASK / 'project')

        self.assertTrue(verdict['passed'], 'the control task must fail the checker')
        self.assertGreaterEqual(verdict['numbers']['blocking'], 1)


if __name__ == '__main__':
    unittest.main()
