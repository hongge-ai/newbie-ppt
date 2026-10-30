#!/usr/bin/env python3
"""
PPT Master - Run Report

Summarize one harness session into the numbers that decide whether a pipeline
change helped: wall clock, steps, tool mix, the files the model actually read,
optional context growth, and the quality-gate timeline with the page count and
error count of every checker call.

Maintainer tool. It never runs during generation and is not part of the
authoring pipeline, so it reads whatever transcript the harness left behind.

Two input shapes are accepted, detected per record:

* DeepSeek Harness — `session.v4.jsonl.zstd`, records keyed `type` + `time`
  (epoch ms) + `data`, tools named `read` / `write` / `pwsh`.
* Generic JSONL — one event per line using the same event names or their
  snake_case aliases (`tool_call`, `tool_result`, `step_start`, …), `time` as
  epoch ms, epoch seconds, or an ISO-8601 string, tool name in `name` / `tool`,
  and the gate output either in `data.message` or a plain `text` field.

Tools are classified by behaviour, not by name, so `Bash`, `bash`, `shell` and
`pwsh` all count as shell calls and any call carrying a `command` counts too.

Usage:
    python3 scripts/run_report.py --session <file.jsonl[.zstd]> [--json] [--context]
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402

SESSIONS_ROOT = Path.home() / '.dsh' / 'sessions'
SESSION_FILENAME = 'session.v4.jsonl.zstd'
_ERROR_COUNT_RE = re.compile(r'With errors:\s*(\d+)')
_BLOCKING_RE = re.compile(r'blocking:\s*(\d+)')
_CHECKER_STAGE_RE = re.compile(r'--stage\s+(first-page|early|page|final)')

# Event names a generic transcript may use for the canonical ones. Both the
# snake_case and the bare form are accepted so a harness that emits
# `{"type": "tool_call"}` or `{"type": "tool_call_event"}` needs no adapter.
_EVENT_ALIASES = {
    'tool_call': 'tool/call',
    'tool_use': 'tool/call',
    'tool_result': 'tool/result',
    'tool_response': 'tool/result',
    'turn_start': 'turn/start',
    'turn_end': 'turn/end',
    'step_start': 'step/start',
    'step_end': 'step/end',
    'assistant_message': 'assistant/message',
    'user_message': 'user/message',
    'system_message': 'system/message',
    'session_start': 'session',
}

# Canonical event names, used to tell an already-normalized record apart from a
# generic one without guessing from the payload.
_CANONICAL_EVENTS = set(_EVENT_ALIASES.values()) | {'tool/call', 'tool/result'}

_SHELL_NAMES = {
    'shell', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd',
    'run_command', 'execute_command', 'exec', 'terminal',
}
_READ_NAMES = {'read', 'read_file', 'file_read', 'view', 'cat', 'open_file'}
_WRITE_NAMES = {
    'write', 'write_file', 'file_write', 'create_file', 'edit', 'edit_file',
    'multi_edit', 'str_replace', 'str_replace_editor', 'apply_patch',
}


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
    """Decode a transcript and normalize it to the canonical event shape."""
    blob = path.read_bytes()
    if path.suffix == '.zstd':
        from compression import zstd

        blob = zstd.decompress(blob)
    text = blob.decode('utf-8', 'replace')
    raw = [json.loads(line) for line in text.splitlines() if line.strip()]
    return normalize_records(raw)


def _parse_time(raw: Any) -> float | None:
    """Return epoch milliseconds for a timestamp in any supported shape."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        # Seconds are ~1.7e9 today; milliseconds ~1.7e12. The 1e11 line
        # separates them for any date between 1973 and 5138.
        return float(raw) * 1000.0 if abs(raw) < 1e11 else float(raw)
    if isinstance(raw, str) and raw.strip():
        text = raw.strip().replace('Z', '+00:00')
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp() * 1000.0
    return None


def _canonical_kind(kind: Any) -> str:
    """Map a generic event name onto the canonical one."""
    name = str(kind or '').replace('-', '_').replace('/', '_')
    if name in _EVENT_ALIASES:
        return _EVENT_ALIASES[name]
    if name.replace('_', '/') in _CANONICAL_EVENTS:
        return name.replace('_', '/')
    return str(kind or '')


def _result_text(message: dict[str, Any]) -> str:
    content = message.get('content')
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    return '\n'.join(
        block.get('text', '') for block in content if isinstance(block, dict)
    )


def normalize_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold any accepted transcript into `type` / `time` / `data` records.

    DeepSeek Harness records already have that shape and pass through untouched.
    A generic record may name the event `type` or `event`, carry its payload at
    the top level, the tool name in `name` / `tool`, and the result text as
    `text` / `output` / `result` / `message`. A record with no parseable time
    inherits the previous one, so ordering alone is enough to place it.
    """
    normalized: list[dict[str, Any]] = []
    previous = 0.0
    for record in records:
        if not isinstance(record, dict):
            continue
        kind = _canonical_kind(record.get('type') or record.get('event'))
        stamp = _parse_time(record.get('time', record.get('timestamp')))
        if stamp is not None:
            previous = stamp
        data: dict[str, Any] = {}
        payload = record.get('data') or record.get('payload')
        if isinstance(payload, dict):
            data.update(payload)
        if kind == 'tool/call':
            call_id = (
                (payload or {}).get('callId')
                or record.get('callId')
                or record.get('id')
                or record.get('tool_call_id')
            )
            if call_id:
                data.setdefault('callId', call_id)
            name = record.get('name') or record.get('tool') or record.get('tool_name')
            if name:
                data.setdefault('name', name)
            arguments = record.get('arguments', record.get('input', record.get('args')))
            if arguments is not None:
                data.setdefault(
                    'arguments',
                    arguments if isinstance(arguments, str) else json.dumps(arguments),
                )
        elif kind == 'tool/result':
            call_id = (
                (payload or {}).get('callId')
                or record.get('toolCallId')
                or record.get('callId')
                or record.get('tool_call_id')
                or record.get('id')
            )
            message = data.get('message')
            if not isinstance(message, dict):
                message = {}
            if call_id and not message.get('toolCallId'):
                message['toolCallId'] = call_id
            if not message.get('content'):
                content = record.get('text', record.get('output', record.get('result')))
                if isinstance(content, str):
                    message['content'] = [{'type': 'text', 'text': content}]
            data['message'] = message
        normalized.append({'type': kind, 'time': previous, 'data': data,
                           'id': record.get('id') or record.get('session_id')})
    return normalized


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
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or '{}')
    except (TypeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _tool_kind(name: str, arguments: dict[str, Any]) -> str:
    """Classify a tool by what it does, not by the name one harness gave it."""
    lowered = name.strip().lower()
    if lowered in _READ_NAMES:
        return 'read'
    if lowered in _WRITE_NAMES:
        return 'write'
    if lowered in _SHELL_NAMES or 'command' in arguments:
        return 'shell'
    return 'other'


def summarize(records: list[dict[str, Any]], *, context: bool = False) -> dict[str, Any]:
    """Fold a session's records into the report payload."""
    records = normalize_records(records)
    stamps = [record['time'] for record in records if isinstance(record.get('time'), (int, float))]
    start, end = (min(stamps), max(stamps)) if stamps else (0.0, 0.0)

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
        kind = _tool_kind(name, arguments)
        if kind == 'read':
            target = str(arguments.get('file_path') or arguments.get('path') or '?')
            reads[target] = reads.get(target, 0) + 1
        elif kind == 'write':
            target = str(arguments.get('file_path') or '').replace('\\', '/')
            if target.endswith('.svg') and 'svg_output' in target:
                pages.setdefault(target.rsplit('/', 1)[-1], minute)
        elif kind == 'shell':
            command = str(arguments.get('command') or '')
            if 'svg_quality_checker.py' not in command or '--help' in command:
                continue
            match = _CHECKER_STAGE_RE.search(command)
            stage = match.group(1) if match else 'final'
            output = results.get(str(data.get('callId')), '')
            failed_pages = _ERROR_COUNT_RE.search(output)
            blocking = _BLOCKING_RE.search(output)
            existing = sum(1 for written in pages.values() if written <= minute)
            gates.append(
                {
                    'minute': round(minute, 1),
                    'stage': stage,
                    'pages': existing,
                    'failed_pages': int(failed_pages.group(1)) if failed_pages else None,
                    'blocking': int(blocking.group(1)) if blocking else None,
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
            failed = '?' if gate['failed_pages'] is None else gate['failed_pages']
            blocking = '?' if gate['blocking'] is None else gate['blocking']
            lines.append(
                f"  +{gate['minute']:5.1f} min  {gate['stage']:10s} "
                f"pages={gate['pages']:2d}  failed_pages={failed}  blocking={blocking}"
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
