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

# A realistic epoch-millisecond base: the normalizer decides "seconds vs
# milliseconds" by magnitude, so a toy base like 1_000_000 reads as seconds.
START = 1_764_000_000_000


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
        tool_result(
            63,
            'c3',
            'Pages: 1\n  [ERROR] With errors: 2 (100%)\n  blocking: 3          hard findings',
        ),
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
            [
                {
                    'minute': 1.0,
                    'stage': 'first-page',
                    'pages': 1,
                    'failed_pages': 2,
                    'blocking': 3,
                }
            ],
        )

    def test_help_invocation_is_not_a_gate(self) -> None:
        self.assertEqual(len(summarize(session())['gates']), 1)

    def test_context_is_optional(self) -> None:
        self.assertIsNone(summarize(session())['context'])
        measured = summarize(session(), context=True)['context']
        self.assertIsNotNone(measured)
        if measured['measured']:
            self.assertGreater(measured['peak_tokens'], 0)


def generic_session() -> list[dict[str, object]]:
    """A transcript from a different harness: snake_case events, ISO times."""
    return [
        {
            'type': 'session_start',
            'timestamp': '2025-11-20T09:00:00Z',
            'session_id': 'generic-1',
        },
        {'type': 'step_start', 'timestamp': '2025-11-20T09:00:01Z'},
        {
            'type': 'tool_call',
            'timestamp': '2025-11-20T09:00:02Z',
            'tool_call_id': 'g1',
            'name': 'Read',
            'input': {'file_path': '/repo/skills/a.md'},
        },
        {
            'type': 'tool_result',
            'timestamp': '2025-11-20T09:00:03Z',
            'tool_call_id': 'g1',
            'text': 'file body',
        },
        {
            'type': 'tool_call',
            'timestamp': '2025-11-20T09:01:00Z',
            'id': 'g2',
            'tool': 'str_replace_editor',
            'input': {'file_path': '/repo/projects/x/svg_output/01_cover.svg'},
        },
        {
            'type': 'tool_call',
            'timestamp': '2025-11-20T09:01:02Z',
            'id': 'g3',
            'tool': 'Bash',
            'input': {
                'command': (
                    'python skills/ppt-master/scripts/svg_quality_checker.py x '
                    '--stage first-page'
                )
            },
        },
        {
            'type': 'tool_result',
            'timestamp': '2025-11-20T09:01:03Z',
            'id': 'g3',
            'output': 'Pages: 1\n  [ERROR] With errors: 2 (100%)\n  blocking: 3',
        },
    ]


class GenericTranscriptTests(unittest.TestCase):
    def test_generic_events_are_normalized(self) -> None:
        report = summarize(generic_session())

        self.assertEqual(report['steps'], 1)
        self.assertEqual(report['tools'], {'Read': 1, 'str_replace_editor': 1, 'Bash': 1})
        self.assertEqual(report['reads'], [{'path': '/repo/skills/a.md', 'count': 1}])
        self.assertEqual([page['name'] for page in report['pages']], ['01_cover.svg'])

    def test_generic_gate_is_recognized_without_the_dsh_tool_name(self) -> None:
        report = summarize(generic_session())

        self.assertEqual(len(report['gates']), 1)
        gate = report['gates'][0]
        self.assertEqual(gate['stage'], 'first-page')
        self.assertEqual(gate['pages'], 1)
        self.assertEqual(gate['failed_pages'], 2)
        self.assertEqual(gate['blocking'], 3)

    def test_iso_timestamps_drive_the_wall_clock(self) -> None:
        report = summarize(generic_session())

        # 09:00:00Z -> 09:01:03Z
        self.assertEqual(report['wall_minutes'], 1.1)

    def test_epoch_seconds_and_milliseconds_agree(self) -> None:
        seconds = [
            {'type': 'session_start', 'time': 1_764_000_000},
            {'type': 'step_start', 'time': 1_764_000_060},
        ]
        millis = [
            {'type': 'session_start', 'time': 1_764_000_000_000},
            {'type': 'step_start', 'time': 1_764_000_060_000},
        ]

        self.assertEqual(summarize(seconds)['wall_minutes'], 1.0)
        self.assertEqual(summarize(millis)['wall_minutes'], 1.0)

    def test_records_without_a_time_inherit_the_previous_one(self) -> None:
        records = [
            {'type': 'session_start', 'time': 1_764_000_000_000},
            {'type': 'step_start'},
            {'type': 'step_start', 'time': 1_764_000_030_000},
        ]

        report = summarize(records)

        self.assertEqual(report['steps'], 2)
        self.assertEqual(report['wall_minutes'], 0.5)

    def test_dsh_records_still_pass_through_untouched(self) -> None:
        report = summarize(session())

        self.assertEqual(report['wall_minutes'], 2.0)
        self.assertEqual(report['tools'], {'read': 1, 'write': 1, 'pwsh': 2})


if __name__ == '__main__':
    unittest.main()
