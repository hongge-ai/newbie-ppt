#!/usr/bin/env python3
"""
PPT Master - Workbench Agent Attach

Connect one AI agent to the resident workbench, then wait until a human
dispatches a task to it. The page lists connected agents; the human picks one
and presses dispatch. This script prints the assigned task and exits, so the
calling agent can pick the work up without anyone copying a trigger sentence.

Usage:
    python3 scripts/workbench_agent.py attach --name "Claude Code"
    python3 scripts/workbench_agent.py attach --workbench http://127.0.0.1:7070

Output on success (one JSON object on stdout):
    {"event": "assigned", "agent_id": "a-1f2e3d4c", "task_id": "t...",
     "task_file": "<abs path>", "topic": "...", "hint": "..."}

Dependencies:
    Standard library only.
"""

from __future__ import annotations

import argparse
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _SCRIPTS_DIR.parents[2]
_LOCK_FILE = _REPO_ROOT / 'projects' / '.workbench' / 'workbench.lock'

HEARTBEAT_SECONDS = 15
POLL_SECONDS = 2


def _default_workbench() -> str:
    try:
        lock = json.loads(_LOCK_FILE.read_text(encoding='utf-8'))
        port = int(lock.get('port'))
        return f'http://127.0.0.1:{port}'
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return 'http://127.0.0.1:7070'


class Workbench:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip('/')

    def call(self, method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(
            self.base + path, data=data, method=method,
            headers={'Content-Type': 'application/json'},
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=15) as response:
                body = response.read().decode('utf-8')
                return response.status, (json.loads(body) if body else {})
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8')
            try:
                return exc.code, json.loads(body) if body else {}
            except json.JSONDecodeError:
                return exc.code, {'error': body[:200]}

    def get(self, path: str) -> tuple[int, dict]:
        return self.call('GET', path)

    def post(self, path: str, payload: dict) -> tuple[int, dict]:
        return self.call('POST', path, payload)


def attach(args: argparse.Namespace) -> int:
    workbench = Workbench(args.workbench)
    status, record = workbench.post('/api/agents/register', {
        'name': args.name,
        'host': socket.gethostname(),
        'pid': None,
    })
    if status != 201:
        print(f'error: cannot register with the workbench: {record.get("error")}', file=sys.stderr)
        return 1
    agent_id = record['agent_id']
    print(f'connected as {record["name"]} ({agent_id}); waiting for dispatch', file=sys.stderr)

    deadline = None if args.timeout <= 0 else time.monotonic() + args.timeout
    last_beat = time.monotonic()

    try:
        while True:
            now = time.monotonic()
            if now - last_beat >= HEARTBEAT_SECONDS:
                last_beat = now
                workbench.post(f'/api/agents/{agent_id}/heartbeat', {})

            status, payload = workbench.get(f'/api/agents/{agent_id}/assignment')
            if status == 200 and payload.get('assignment'):
                task = payload.get('task') or {}
                task_id = task.get('task_id')
                detail = {}
                if task_id:
                    detail_status, detail = workbench.get(f'/api/tasks/{task_id}')
                    if detail_status != 200:
                        detail = {}
                print(json.dumps({
                    'event': 'assigned',
                    'agent_id': agent_id,
                    'agent_name': record['name'],
                    'task_id': task_id,
                    'task_file': task.get('task_file'),
                    'topic': task.get('topic') or detail.get('topic'),
                    'display_title': task.get('display_title') or detail.get('display_title'),
                    'hint': detail.get('agent_hint'),
                }, ensure_ascii=False))
                return 0

            if deadline is not None and now >= deadline:
                print('error: timed out waiting for a dispatch', file=sys.stderr)
                return 124
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print('detached', file=sys.stderr)
        return 130


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Attach an AI agent to the workbench and wait for a dispatched task.')
    parser.add_argument('action', nargs='?', default='attach', choices=('attach',))
    parser.add_argument('--workbench', default=_default_workbench(),
                        help='Workbench base URL (default: discovered lock or 127.0.0.1:7070)')
    parser.add_argument('--name', default=socket.gethostname()[:60],
                        help='Name shown in the dispatch list')
    parser.add_argument('--timeout', type=int, default=0,
                        help='Seconds before giving up (0 waits until dispatch)')
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return attach(args)


if __name__ == '__main__':
    raise SystemExit(main())
