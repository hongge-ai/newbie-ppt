#!/usr/bin/env python3
"""PPT Master - Workbench agent presence and dispatch

Agents register and heartbeat; a human dispatches a submitted task to exactly
one online agent. These routes are the only place that decides who may pick a
task up, so exclusivity and expiry matter.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_workbench_agents

Dependencies:
    flask
"""

import json
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import workbench.server as workbench_server  # noqa: E402


class AgentDispatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects = Path(self.temporary.name)
        with patch.object(workbench_server.threading.Thread, 'start'):
            self.app = workbench_server.create_app(str(self.projects), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _task(self, submitted: bool = True) -> str:
        created = self.client.post('/api/tasks', json={'topic': '分派测试'}).get_json()
        task_id = created['task_id']
        if submitted:
            self.client.post(f'/api/tasks/{task_id}/submit', json={})
        return task_id

    def _agent(self, name: str = 'Claude Code') -> str:
        response = self.client.post('/api/agents/register', json={'name': name, 'host': 'dev-box'})
        self.assertEqual(response.status_code, 201)
        return response.get_json()['agent_id']

    def test_registered_agent_is_listed_as_online(self) -> None:
        agent_id = self._agent()
        agents = self.client.get('/api/agents').get_json()['agents']
        self.assertEqual([item['agent_id'] for item in agents], [agent_id])
        self.assertTrue(agents[0]['online'])

    def test_heartbeat_refreshes_presence(self) -> None:
        agent_id = self._agent()
        path = self.projects / '.workbench' / 'agents' / f'{agent_id}.json'
        record = json.loads(path.read_text(encoding='utf-8'))
        record['last_seen'] = (datetime.now() - timedelta(minutes=5)).isoformat(timespec='seconds')
        path.write_text(json.dumps(record), encoding='utf-8')
        self.assertFalse(self.client.get('/api/agents').get_json()['agents'][0]['online'])
        self.assertEqual(self.client.post(f'/api/agents/{agent_id}/heartbeat', json={}).status_code, 200)
        self.assertTrue(self.client.get('/api/agents').get_json()['agents'][0]['online'])

    def test_draft_task_cannot_be_dispatched(self) -> None:
        agent_id = self._agent()
        task_id = self._task(submitted=False)
        response = self.client.post(f'/api/tasks/{task_id}/assign', json={'agent_id': agent_id})
        self.assertEqual(response.status_code, 409)

    def test_dispatch_is_exclusive_and_reaches_the_agent(self) -> None:
        first = self._agent('Claude Code')
        second = self._agent('Codex')
        task_id = self._task()

        response = self.client.post(f'/api/tasks/{task_id}/assign', json={'agent_id': first})
        self.assertEqual(response.status_code, 200)

        claimed = self.client.get(f'/api/agents/{first}/assignment')
        self.assertEqual(claimed.status_code, 200)
        self.assertEqual(claimed.get_json()['task']['task_id'], task_id)
        self.assertEqual(self.client.get(f'/api/agents/{second}/assignment').status_code, 204)

        conflict = self.client.post(f'/api/tasks/{task_id}/assign', json={'agent_id': second})
        self.assertEqual(conflict.status_code, 409)

        detail = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(detail['assignment']['agent_id'], first)

        cleared = self.client.delete(f'/api/tasks/{task_id}/assign')
        self.assertTrue(cleared.get_json()['cleared'])
        self.assertEqual(self.client.get(f'/api/agents/{first}/assignment').status_code, 204)

    def test_offline_agent_cannot_be_dispatched(self) -> None:
        agent_id = self._agent()
        path = self.projects / '.workbench' / 'agents' / f'{agent_id}.json'
        record = json.loads(path.read_text(encoding='utf-8'))
        record['last_seen'] = (datetime.now() - timedelta(minutes=5)).isoformat(timespec='seconds')
        path.write_text(json.dumps(record), encoding='utf-8')
        task_id = self._task()
        response = self.client.post(f'/api/tasks/{task_id}/assign', json={'agent_id': agent_id})
        self.assertEqual(response.status_code, 409)

    def test_expired_assignment_returns_the_task_to_the_pool(self) -> None:
        agent_id = self._agent()
        task_id = self._task()
        self.client.post(f'/api/tasks/{task_id}/assign', json={'agent_id': agent_id})
        path = self.projects / '.workbench' / 'assignments' / f'{task_id}.json'
        record = json.loads(path.read_text(encoding='utf-8'))
        record['expires_at'] = (datetime.now() - timedelta(seconds=1)).isoformat(timespec='seconds')
        path.write_text(json.dumps(record), encoding='utf-8')
        self.assertEqual(self.client.get(f'/api/agents/{agent_id}/assignment').status_code, 204)
        self.assertIsNone(self.client.get(f'/api/tasks/{task_id}').get_json()['assignment'])


if __name__ == '__main__':
    unittest.main()
