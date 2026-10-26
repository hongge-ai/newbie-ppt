#!/usr/bin/env python3
"""
PPT Master - Run Report

Summarize one harness session into the numbers that decide whether a pipeline
change helped: wall clock, steps, tool mix, the files the model actually read,
optional context growth, and the quality-gate timeline with the page count and
error count of every checker call.

Maintainer tool. It reads a DeepSeek Harness session transcript, so it never
runs during generation and is not part of the authoring pipeline.

Usage:
    python3 scripts/run_report.py --session <session.v4.jsonl.zstd> [--json] [--context]
    python3 scripts/run_report.py --latest [--json] [--context]

Examples:
    python3 scripts/run_report.py --latest
    python3 scripts/run_report.py --session ~/.dsh/sessions/<workspace>/<id>/session.v4.jsonl.zstd --json

Dependencies:
    None (standard library only); tiktoken is optional and only used by --context.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402

SESSIONS_ROOT = Path.home() / '.dsh' / 'sessions'
SESSION_FILENAME = 'session.v4.jsonl.zstd'
_ERROR_COUNT_RE = re.compile(r'With errors:\s*(\d+)')
_CHECKER_STAGE_RE = re.compile(r'--stage\s+(first-page|early|page|final)')


def session_path(raw: str) -> Path:
    """Resolve one session file from a directory or an explicit path."""
    path = Path(raw).expanduser()
    if path.is_dir():
        path = path / SESSION_FILENAME
    if not path.is_file():
        raise SystemExit(f'[ERROR] session not found: {path}')
    return path


def latest_session(root: Path = SESSIONS_ROOT) -> Path:
    """Return the most recently written session under the harness root."""
    candidates = sorted(
        root.glob(f'*/*/{SESSION_FILENAME}'),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise SystemExit(f'[ERROR] no {SESSION_FILENAME} under {root}')
    return candidates[0]


def load_records(path: Path) -> list[dict[str, Any]]:
    """Decode a session transcript, compressing only when the file is zstd."""
    blob = path.read_bytes()
    if path.suffix == '.zstd':
        from compression import zstd

        blob = zstd.decompress(blob)
    text = blob.decode('utf-8', 'replace')
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _result_text(message: dict[str, Any]) -> str:
    content = message.get('content')
    if not isinstance(content, list):
        return ''
    return '\n'.join(
        block.get('text', '') for block in content if isinstance(block, dict)
    )


def _message_text(message: dict[str, Any]) -> str:
    content = message.get('content')
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content or []:
        if not isinstance(block, dict):
            continue
        kind = block.get('type')
        if kind in ('text', 'reasoning'):
            parts.append(block.get('text') or '')
        elif kind == 'tool-call':
            parts.append(str(block.get('arguments') or ''))
    return '\n'.join(parts)


def _arguments(raw: Any) -> dict[str, Any]:
    try:
        value = json.loads(raw or '{}')
    except (TypeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def summarize(records: list[dict[str, Any]], *, context: bool = False) -> dict[str, Any]:
    """Fold a session's records into the report payload."""
    stamps = [record['time'] for record in records if 'time' in record]
    start, end = min(stamps), max(stamps)

    tools: dict[str, int] = {}
    reads: dict[str, int] = {}
    pages: dict[str, float] = {}
    gates: list[dict[str, Any]] = []
    results: dict[str, str] = {}
    tokens = 0
    peak_tokens = 0
    encoder = None
    if context:
        try:
            import tiktoken
        except ImportError:
            encoder = None
        else:
            encoder = tiktoken.get_encoding('o200k_base')

    for record in records:
        kind = record['type']
        data = record.get('data') or {}
        if encoder is not None:
            if kind in ('system/message', 'user/message', 'tool/result'):
                tokens += len(encoder.encode(_message_text(data.get('message') or data)))
                peak_tokens = max(peak_tokens, tokens)
            elif kind == 'assistant/message':
                tokens += len(encoder.encode(_message_text(data.get('message') or {})))
                peak_tokens = max(peak_tokens, tokens)
        if kind == 'tool/result':
            message = data.get('message') or {}
            call_id = message.get('toolCallId') or (message.get('source') or {}).get('callId')
            if call_id:
                results[call_id] = _result_text(message)

    for record in records:
        if record['type'] != 'tool/call':
            continue
        data = record['data']
        name = str(data.get('name'))
        arguments = _arguments(data.get('arguments'))
        tools[name] = tools.get(name, 0) + 1
        minute = (record['time'] - start) / 60000
        if name == 'read':
            target = str(arguments.get('file_path') or arguments.get('path') or '?')
            reads[target] = reads.get(target, 0) + 1
        elif name in ('write', 'edit'):
            target = str(arguments.get('file_path') or '').replace('\\', '/')
            if target.endswith('.svg') and 'svg_output' in target:
                pages.setdefault(target.rsplit('/', 1)[-1], minute)
        elif name == 'pwsh':
            command = str(arguments.get('command') or '')
            if 'svg_quality_checker.py' not in command or '--help' in command:
                continue
            match = _CHECKER_STAGE_RE.search(command)
            stage = match.group(1) if match else 'final'
            output = results.get(str(data.get('callId')), '')
            errors = _ERROR_COUNT_RE.search(output)
            existing = sum(1 for written in pages.values() if written <= minute)
            gates.append(
                {
                    'minute': round(minute, 1),
                    'stage': stage,
                    'pages': existing,
                    'errors': int(errors.group(1)) if errors else None,
                }
            )

    return {
        'session': str(records[0].get('id', '')) if records else '',
        'wall_minutes': round((end - start) / 60000, 1),
        'turns': sum(1 for record in records if record['type'] == 'turn/start'),
        'steps': sum(1 for record in records if record['type'] == 'step/start'),
        'tools': dict(sorted(tools.items(), key=lambda item: -item[1])),
        'reads': [
            {'path': path, 'count': count}
            for path, count in sorted(reads.items(), key=lambda item: -item[1])
        ],
        'pages': [
            {'name': name, 'minute': round(minute, 1)}
            for name, minute in sorted(pages.items(), key=lambda item: item[1])
        ],
        'gates': gates,
        'context': (
            {'peak_tokens': peak_tokens, 'measured': encoder is not None}
            if context
            else None
        ),
    }


def _shorten(path: str, root: Path | None) -> str:
    if root is None:
        return path
    try:
        return str(Path(path).resolve().relative_to(root.resolve()))
    except ValueError:
        return path


def render(report: dict[str, Any], *, root: Path | None = None) -> str:
    """Render the human summary."""
    lines = [
        '[RUN] ' + report['session'],
        f"  wall {report['wall_minutes']} min | turns {report['turns']} | "
        f"steps {report['steps']}",
        '  tools ' + ' | '.join(f'{name} {count}' for name, count in report['tools'].items()),
    ]
    context = report.get('context')
    if context:
        if context['measured']:
            lines.append(f"  context peak {context['peak_tokens']:,} tokens")
        else:
            lines.append('  context unavailable (tiktoken not installed)')
    if report['reads']:
        lines.append('')
        lines.append(f"Reads ({len(report['reads'])})")
        for entry in report['reads']:
            lines.append(f"  {entry['count']}x  {_shorten(entry['path'], root)}")
    if report['pages']:
        lines.append('')
        lines.append(f"Authored pages ({len(report['pages'])})")
        for entry in report['pages']:
            lines.append(f"  +{entry['minute']:5.1f} min  {entry['name']}")
    if report['gates']:
        lines.append('')
        lines.append('Quality gates')
        for gate in report['gates']:
            errors = '?' if gate['errors'] is None else gate['errors']
            lines.append(
                f"  +{gate['minute']:5.1f} min  {gate['stage']:10s} "
                f"pages={gate['pages']:2d}  errors={errors}"
            )
    return '\n'.join(lines) + '\n'


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Summarize a harness session into run metrics.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--session', help='Session file or its directory')
    source.add_argument(
        '--latest',
        action='store_true',
        help=f'Use the newest {SESSION_FILENAME} under {SESSIONS_ROOT}',
    )
    parser.add_argument(
        '--sessions-root',
        type=Path,
        default=SESSIONS_ROOT,
        help=f'Root searched by --latest (default: {SESSIONS_ROOT})',
    )
    parser.add_argument(
        '--root',
        type=Path,
        help='Shorten read paths against this project/repository root',
    )
    parser.add_argument('--context', action='store_true', help='Measure context growth (needs tiktoken)')
    parser.add_argument('--json', action='store_true', help='Emit the report as JSON')
    return parser


def main(argv: list[str] | None = None) -> int:
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    path = (
        latest_session(args.sessions_root)
        if args.latest or not args.session
        else session_path(args.session)
    )
    report = summarize(load_records(path), context=args.context)
    if args.json:
        sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    else:
        sys.stdout.write(render(report, root=args.root))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
