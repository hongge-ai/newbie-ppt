#!/usr/bin/env python3
"""PPT Master - Workbench Custom Template Tests

Exercise the saved custom-template registry ("我的模板"): CRUD endpoints,
name uniqueness, index-validity flags, and the save -> expand -> task
selection link.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_workbench_custom_templates

Dependencies:
    flask
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from workbench import server  # noqa: E402


def _create_payload(name='我的组合', selections=None):
    return {
        'name': name,
        'selections': selections or [
            {'kind': 'style', 'id': 'consulting-decision'},
            {'kind': 'deck', 'id': '中国电信'},
        ],
    }


class WorkbenchCustomTemplateTests(unittest.TestCase):
    def setUp(self) -> None:
        # ignore_cleanup_errors: Windows Defender intermittently holds a
        # freshly written record during real-time scanning.
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _create(self, payload=None):
        response = self.client.post(
            '/api/custom-templates',
            json=payload if payload is not None else _create_payload(),
        )
        return response

    def test_list_starts_empty(self) -> None:
        response = self.client.get('/api/custom-templates')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'custom_templates': []})

    def test_create_and_roundtrip(self) -> None:
        response = self._create()
        self.assertEqual(response.status_code, 201)
        body = response.get_json()
        self.assertRegex(body['id'], r'^ct\d{8}-\d{6}-[0-9a-f]{4}$')
        self.assertEqual(body['name'], '我的组合')
        self.assertEqual(body['invalid'], [])
        self.assertEqual(body['summary'], 'style/consulting-decision + deck/中国电信')

        listed = self.client.get('/api/custom-templates').get_json()
        self.assertEqual(len(listed['custom_templates']), 1)
        self.assertEqual(listed['custom_templates'][0]['id'], body['id'])
        self.assertEqual(
            listed['custom_templates'][0]['selections'],
            [
                {'kind': 'style', 'id': 'consulting-decision'},
                {'kind': 'deck', 'id': '中国电信'},
            ],
        )

        record_path = (
            self.projects_root / '.workbench' / 'custom_templates'
            / f'{body["id"]}.json'
        )
        self.assertTrue(record_path.is_file())

    def test_create_rejects_bad_input(self) -> None:
        for payload in (
            {},
            {'name': '   ', 'selections': [{'kind': 'style', 'id': 'consulting-decision'}]},
            {'name': 'x' * 41, 'selections': [{'kind': 'style', 'id': 'consulting-decision'}]},
            {'name': 'ok', 'selections': []},
            {'name': 'ok', 'selections': [{'kind': 'style', 'id': 'no-such-style'}]},
            {'name': 'ok', 'selections': [
                {'kind': 'style', 'id': 'consulting-decision'},
                {'kind': 'style', 'id': 'mbb-consulting'},
            ]},
        ):
            with self.subTest(payload=payload):
                response = self._create(payload)
                self.assertEqual(response.status_code, 400)

    def test_create_name_conflict_reports_existing_id(self) -> None:
        first = self._create().get_json()
        response = self._create()
        self.assertEqual(response.status_code, 409)
        body = response.get_json()
        self.assertEqual(body['error'], 'name already exists')
        self.assertEqual(body['existing_id'], first['id'])

    def test_update_renames_and_reselects(self) -> None:
        ct_id = self._create().get_json()['id']
        response = self.client.put(f'/api/custom-templates/{ct_id}', json={
            'name': '新名字',
            'selections': [{'kind': 'style', 'id': 'mbb-consulting'}],
        })
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body['name'], '新名字')
        self.assertEqual(body['summary'], 'style/mbb-consulting')

        # Same-name update on the same record is allowed.
        response = self.client.put(f'/api/custom-templates/{ct_id}', json={
            'name': '新名字',
        })
        self.assertEqual(response.status_code, 200)

    def test_update_rename_onto_other_name_conflicts(self) -> None:
        first = self._create(_create_payload(name='第一个')).get_json()
        self._create(_create_payload(name='第二个'))
        response = self.client.put(f"/api/custom-templates/{first['id']}", json={
            'name': '第二个',
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.get_json()['error'], 'name already exists',
        )

    def test_delete_and_unknown_ids(self) -> None:
        ct_id = self._create().get_json()['id']
        self.assertEqual(
            self.client.delete(f'/api/custom-templates/{ct_id}').status_code, 200,
        )
        self.assertEqual(
            self.client.get('/api/custom-templates').get_json()['custom_templates'], [],
        )
        self.assertEqual(
            self.client.delete(f'/api/custom-templates/{ct_id}').status_code, 404,
        )
        self.assertEqual(
            self.client.put('/api/custom-templates/not-an-id', json={}).status_code, 404,
        )
        self.assertEqual(
            self.client.put(
                '/api/custom-templates/ct20990101-000000-beef', json={},
            ).status_code, 404,
        )

    def test_stale_selection_is_flagged_invalid(self) -> None:
        ct_id = self._create().get_json()['id']
        record_path = (
            self.projects_root / '.workbench' / 'custom_templates' / f'{ct_id}.json'
        )
        record = json.loads(record_path.read_text(encoding='utf-8'))
        record['selections'].append({'kind': 'style', 'id': 'removed-style'})
        server._write_json_atomic(record_path, record)

        listed = self.client.get('/api/custom-templates').get_json()
        self.assertEqual(
            listed['custom_templates'][0]['invalid'], ['style/removed-style'],
        )

    def test_saved_template_expands_into_task_selection(self) -> None:
        ct_id = self._create().get_json()['id']
        listed = self.client.get('/api/custom-templates').get_json()
        saved = listed['custom_templates'][0]

        task_id = self.client.post(
            '/api/tasks', json={'topic': '扩写组合'},
        ).get_json()['task_id']
        response = self.client.patch(f'/api/tasks/{task_id}', json={
            'template_selection': {
                'mode': 'templates',
                'selections': saved['selections'],
            },
        })
        self.assertEqual(response.status_code, 200)
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        chosen = {
            item['kind']: item for item in task['template_selection']['selections']
        }
        self.assertEqual(chosen['style']['workspace_root'],
                         str(server._templates_dir() / 'styles' / 'consulting-decision'))
        self.assertEqual(chosen['deck']['workspace_root'],
                         str(server._templates_dir() / 'decks' / '中国电信'))


if __name__ == '__main__':
    unittest.main()
