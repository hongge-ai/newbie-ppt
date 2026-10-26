#!/usr/bin/env python3
"""Focused tests for the maintainer run-report summarizer."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from run_report import summarize  # noqa: E402

START = 1_000_000


def record(kind: str, offset_seconds: float, **data: object) -> dict[str, object]:
    return {
        'type': kind,
        'time': START + int(offset_seconds * 1000),
        'data': data,
    }


def tool_call(
    name: str,
    offset_seconds: float,
    call_id: str,
    arguments: str,
) -> dict[str, object]:
    return record('tool/call', offset_seconds, name=name, callId=call_id, arguments=arguments)


def tool_result(offset_seconds: float, call_id: str, text: str) -> dict[str, object]:
    return record(
        'tool/result',
        offset_seconds,
        message={
            'role': 'tool',
            'toolCallId': call_id,
            'content': [{'type': 'text', 'text': text}],
        },
    )


def session() -> list[dict[str, object]]:
    return [
        record('session', 0),
        record('turn/start', 0.1, turn=1),
        record('step/start', 1, turn=1, step=1),
        tool_call('read', 2, 'c1', '{"file_path": "/repo/skills/a.md"}'),
        tool_result(3, 'c1', 'file body'),
        tool_call(
            'write',
            60,
            'c2',
            '{"file_path": "/repo/projects/x/svg_output/01_cover.svg"}',
        ),
        record('step/start', 61, turn=1, step=2),
        tool_call(
            'pwsh',
            62,
            'c3',
            '{"command": "python skills/ppt-master/scripts/svg_quality_checker.py x --stage first-page"}',
        ),
        tool_result(63, 'c3', 'Pages: 1\n  [ERROR] With errors: 2 (100%)'),
        tool_call('pwsh', 90, 'c4', '{"command": "svg_quality_checker.py --help"}'),
        tool_result(91, 'c4', 'usage'),
        record('turn/end', 120),
    ]


class RunReportTests(unittest.TestCase):
    def test_totals_and_tool_mix(self) -> None:
        report = summarize(session())

        self.assertEqual(report['wall_minutes'], 2.0)
        self.assertEqual(report['turns'], 1)
        self.assertEqual(report['steps'], 2)
        self.assertEqual(report['tools'], {'read': 1, 'write': 1, 'pwsh': 2})

    def test_reads_are_counted_per_path(self) -> None:
        records = session()
        records.append(tool_call('read', 100, 'c5', '{"file_path": "/repo/skills/a.md"}'))

        report = summarize(records)

        self.assertEqual(report['reads'], [{'path': '/repo/skills/a.md', 'count': 2}])

    def test_gate_reports_pages_present_and_error_count(self) -> None:
        report = summarize(session())

        self.assertEqual(
            report['gates'],
            [{'minute': 1.0, 'stage': 'first-page', 'pages': 1, 'errors': 2}],
        )

    def test_help_invocation_is_not_a_gate(self) -> None:
        self.assertEqual(len(summarize(session())['gates']), 1)

    def test_context_is_optional(self) -> None:
        self.assertIsNone(summarize(session())['context'])
        measured = summarize(session(), context=True)['context']
        self.assertIsNotNone(measured)
        if measured['measured']:
            self.assertGreater(measured['peak_tokens'], 0)


if __name__ == '__main__':
    unittest.main()
