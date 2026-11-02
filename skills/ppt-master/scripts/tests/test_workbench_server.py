#!/usr/bin/env python3
"""PPT Master - Workbench Server Tests

Exercise the repository-level workbench app factory without running a server.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_workbench_server

Dependencies:
    flask
"""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import agent_bridge  # noqa: E402
from workbench import server  # noqa: E402


class WorkbenchAppTests(unittest.TestCase):
    def setUp(self) -> None:
        # ignore_cleanup_errors: Windows Defender intermittently holds a
        # freshly written task.json during real-time scanning, which would
        # otherwise fail an unrelated teardown.
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _make_task(self, task_id: str) -> Path:
        task_dir = self.projects_root / '.workbench' / 'tasks' / task_id
        task_dir.mkdir(parents=True)
        task_file = task_dir / server.TASK_FILE_NAME
        task_file.write_text(
            json.dumps({'schema_version': 1, 'task_id': task_id, 'status': 'draft'}),
            encoding='utf-8',
        )
        return task_file

    def test_health_reports_service_identity(self) -> None:
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data['service'], 'workbench')
        self.assertEqual(data['status'], 'ok')
        self.assertEqual(data['repo_root'], str(self.projects_root.parent))
        self.assertEqual(data['projects_root'], str(self.projects_root))
        self.assertEqual(data['task_count'], 0)

    def test_health_counts_task_records(self) -> None:
        self._make_task('t20261015-120000-abcd')
        self._make_task('t20261015-130000-ef01')
        self.client.post('/api/shutdown', json={'reason': 'reset-activity'})
        data = self.client.get('/api/health').get_json()
        self.assertEqual(data['task_count'], 2)

    def test_health_ignores_directories_without_task_file(self) -> None:
        (self.projects_root / '.workbench' / 'tasks' / 'junk').mkdir(parents=True)
        data = self.client.get('/api/health').get_json()
        self.assertEqual(data['task_count'], 0)

    def test_index_serves_shell(self) -> None:
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('text/html', response.headers['Content-Type'])

    def test_loopback_hosts_are_accepted(self) -> None:
        for host in ('127.0.0.1', '127.0.0.1:7070', 'localhost', 'localhost:7070',
                     'LOCALHOST:7070', '::1', '[::1]', '[::1]:7070'):
            with self.subTest(host=host):
                response = self.client.get('/api/health', headers={'Host': host})
                self.assertEqual(response.status_code, 200)

    def test_other_hosts_are_rejected(self) -> None:
        for host in ('evil.example:7070', '127.0.0.1.evil.example', 'localhost.evil.example',
                     '192.168.1.1', '[::2]:7070', '::1:7070', 'evil@localhost:7070', ''):
            with self.subTest(host=host):
                self.app.config['LAST_REQUEST_TIME'] = 0
                response = self.client.get('/api/health', headers={'Host': host})
                self.assertEqual(response.status_code, 403)
                self.assertEqual(self.app.config['LAST_REQUEST_TIME'], 0)

    def test_foreign_origins_are_rejected(self) -> None:
        for origin in ('http://evil.example', 'http://127.0.0.1.evil.example'):
            with self.subTest(origin=origin):
                response = self.client.get('/api/health', headers={'Origin': origin})
                self.assertEqual(response.status_code, 403)

    def test_loopback_origins_and_missing_origin_are_accepted(self) -> None:
        for origin in (None, 'http://127.0.0.1:7070', 'http://localhost:7070',
                       'https://LOCALHOST:7070', 'http://[::1]', 'http://[::1]:7070'):
            with self.subTest(origin=origin):
                headers = {} if origin is None else {'Origin': origin}
                self.assertEqual(
                    self.client.get('/api/health', headers=headers).status_code, 200,
                )

    def test_default_projects_root_matches_project_management(self) -> None:
        from project_management.paths import PROJECTS_ROOT
        self.assertEqual(server.DEFAULT_PROJECTS_ROOT, PROJECTS_ROOT)

    def test_health_response_is_not_cached(self) -> None:
        response = self.client.get('/api/health')
        self.assertEqual(response.headers.get('Cache-Control'), 'no-store')


class TaskLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        # ignore_cleanup_errors: Windows Defender intermittently holds a
        # freshly written task.json during real-time scanning, which would
        # otherwise fail an unrelated teardown.
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _create(self, topic: str = '测试主题') -> str:
        response = self.client.post('/api/tasks', json={'topic': topic})
        self.assertEqual(response.status_code, 201)
        return response.get_json()['task_id']

    def _task_file(self, task_id: str) -> Path:
        return self.projects_root / '.workbench' / 'tasks' / task_id / 'task.json'

    def _upload(self, task_id: str, name: str, content: bytes = b'data'):
        return self.client.post(
            f'/api/tasks/{task_id}/uploads',
            data={'files': (io.BytesIO(content), name)},
            content_type='multipart/form-data',
        )

    def test_full_draft_lifecycle(self) -> None:
        task_id = self._create('做一个季度汇报')
        # defaults
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(task['status'], 'draft')
        self.assertNotIn('profile', task['params'])
        self.assertNotIn('template_selection', task)
        # patch
        response = self.client.patch(f'/api/tasks/{task_id}', json={
            'display_title': 'Q3 汇报',
            'requirements': {'audience': '管理层'},
            'params': {'canvas': 'ppt43', 'page_count': 10, 'speaker_notes': True},
        })
        self.assertEqual(response.status_code, 200)
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(task['display_title'], 'Q3 汇报')
        self.assertEqual(task['params']['canvas'], 'ppt43')
        self.assertEqual(task['params']['page_count'], 10)
        self.assertTrue(task['params']['speaker_notes'])
        # upload then submit
        self.assertEqual(self._upload(task_id, '需求文档.docx').status_code, 201)
        response = self.client.post(f'/api/tasks/{task_id}/submit')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['status'], 'submitted')
        self.assertIn(task_id, payload['agent_hint'])
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(task['status'], 'submitted')
        self.assertEqual(task['uploads'], [{'name': '需求文档.docx', 'size': 4}])

    def test_create_requires_topic(self) -> None:
        response = self.client.post('/api/tasks', json={'topic': '   '})
        self.assertEqual(response.status_code, 400)

    def test_patch_validates_params(self) -> None:
        task_id = self._create()
        for patch_payload in (
            {'params': {'canvas': 'poster99'}},
            {'params': {'page_count': 0}},
            {'params': {'page_count': 'ten'}},
            {'params': {'image_policy': 'stock'}},
            {'params': {'speaker_notes': 'yes'}},
            {'topic': ''},
            {'display_title': 42},
        ):
            with self.subTest(patch=patch_payload):
                response = self.client.patch(f'/api/tasks/{task_id}', json=patch_payload)
                self.assertEqual(response.status_code, 400)

    def test_submitted_task_is_frozen(self) -> None:
        task_id = self._create()
        self.client.post(f'/api/tasks/{task_id}/submit')
        self.assertEqual(
            self.client.patch(f'/api/tasks/{task_id}', json={'topic': '新主题'}).status_code,
            409,
        )
        self.assertEqual(self._upload(task_id, 'x.pdf').status_code, 409)
        self.assertEqual(
            self.client.delete(f'/api/tasks/{task_id}/uploads/x.pdf').status_code, 409,
        )
        self.assertEqual(
            self.client.post(f'/api/tasks/{task_id}/submit').status_code, 409,
        )

    def test_sanitize_upload_name(self) -> None:
        cases = {
            '..\\..\\evil.docx': 'evil.docx',
            '../../etc/passwd': 'passwd',
            '  季度报告.docx  ': '季度报告.docx',
            'bad<name>.pptx': 'badname.pptx',
            'trailing...': 'trailing',
            '.': None,
            '   ': None,
            42: None,
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(server._sanitize_upload_name(raw), expected)

    def test_upload_deduplicates_names(self) -> None:
        task_id = self._create()
        self.assertEqual(self._upload(task_id, '材料.docx').status_code, 201)
        self.assertEqual(self._upload(task_id, '材料.docx').status_code, 201)
        listing = self.client.get(f'/api/tasks/{task_id}').get_json()['uploads_present']
        names = sorted(item['name'] for item in listing)
        self.assertEqual(names, ['材料.docx', '材料_2.docx'])
        self.assertEqual(self._upload(task_id, '   ').status_code, 400)

    def test_delete_upload_rejects_traversal(self) -> None:
        task_id = self._create()
        self._upload(task_id, 'keep.docx')
        response = self.client.delete(f'/api/tasks/{task_id}/uploads/..%2F..%2Ftask.json')
        self.assertEqual(response.status_code, 404)
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(task['status'], 'draft')

    def test_list_skips_junk_and_flags_corrupt_records(self) -> None:
        good = self._create('正常任务')
        corrupt_dir = self.projects_root / '.workbench' / 'tasks' / 't20990101-000000-dead'
        corrupt_dir.mkdir(parents=True)
        (corrupt_dir / 'task.json').write_text('{broken', encoding='utf-8')
        junk_dir = self.projects_root / '.workbench' / 'tasks' / 'not-a-task-id'
        junk_dir.mkdir(parents=True)
        (junk_dir / 'task.json').write_text('{}', encoding='utf-8')
        payload = self.client.get('/api/tasks').get_json()
        statuses = {item['task_id']: item['status'] for item in payload['tasks']}
        self.assertEqual(statuses[good], 'draft')
        self.assertEqual(statuses['t20990101-000000-dead'], 'error')
        self.assertNotIn('not-a-task-id', statuses)

    def test_agent_binding_is_visible_without_restart(self) -> None:
        task_id = self._create()
        self.client.post(f'/api/tasks/{task_id}/submit')
        project = self.projects_root / 'demo_20261015'
        project.mkdir()
        agent_bridge.start_run(project, task=task_id)
        agent_bridge.enter_stage(project, 'execute')
        seen = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(seen['status'], 'processing')
        self.assertEqual(seen['runtime']['project_dir'], str(project))
        self.assertEqual(seen['runtime']['stage'], 'execute')
        # A later agent write needs no restart: the next request re-derives.
        agent_bridge.set_progress(project, 3, 8)
        moved = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(moved['runtime']['progress'], {'done': 3, 'total': 8, 'unit': 'page'})
        agent_bridge.end_run(project, 'done')
        self.assertEqual(self.client.get(f'/api/tasks/{task_id}').get_json()['status'], 'done')

    def test_task_json_holds_only_the_user_domain(self) -> None:
        task_id = self._create()
        self.client.post(f'/api/tasks/{task_id}/submit')
        project = self.projects_root / 'demo_20261017'
        project.mkdir()
        agent_bridge.start_run(project, task=task_id)
        agent_bridge.enter_stage(project, 'execute')
        agent_bridge.end_run(project, 'done')
        task = json.loads(self._task_file(task_id).read_text(encoding='utf-8-sig'))
        self.assertEqual(set(task), set(server.USER_DOMAIN_FIELDS))
        self.assertEqual(task['task_id'], task_id)
        self.assertIsNotNone(task['submitted_at'])

    def test_options_endpoint_syncs_canvas_from_config(self) -> None:
        response = self.client.get('/api/options')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(any(item['id'] == 'ppt169' for item in data['canvas']))
        self.assertTrue(data['image_policies'])
        self.assertTrue(data['languages'])
        self.assertTrue(data['page_counts'])


class ProgressAndFeedbackTests(unittest.TestCase):
    def setUp(self) -> None:
        # ignore_cleanup_errors: Windows Defender intermittently holds a
        # freshly written task.json during real-time scanning, which would
        # otherwise fail an unrelated teardown.
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        response = self.client.post('/api/tasks', json={'topic': '进度测试'})
        self.task_id = response.get_json()['task_id']

    def _task_file(self) -> Path:
        return self.projects_root / '.workbench' / 'tasks' / self.task_id / 'task.json'

    def _attach_project(self, project_name: str) -> Path:
        """Simulate the agent side: submit the task, then bind a real project."""
        self.client.post(f'/api/tasks/{self.task_id}/submit')
        project_path = self.projects_root / project_name
        project_path.mkdir(parents=True, exist_ok=True)
        agent_bridge.start_run(project_path, task=self.task_id)
        agent_bridge.enter_stage(project_path, 'execute')
        return project_path

    def test_progress_without_project_is_empty(self) -> None:
        payload = self.client.get(f'/api/tasks/{self.task_id}/progress').get_json()
        self.assertEqual(payload['status'], 'draft')
        self.assertEqual(payload['slides'], [])
        self.assertEqual(payload['exports'], [])
        self.assertIsNone(payload['confirm'])
        self.assertEqual(payload['quality'], {'report_exists': False})

    def test_progress_derives_from_project_tree(self) -> None:
        project = self._attach_project('demo_20261015')
        (project / 'svg_output').mkdir(parents=True)
        (project / 'svg_output' / 'P02.svg').write_text('<svg/>', encoding='utf-8')
        (project / 'svg_output' / 'P01.svg').write_text('<svg/>', encoding='utf-8')
        (project / 'svg_output' / 'notes.txt').write_text('junk', encoding='utf-8')
        (project / 'validation').mkdir()
        (project / 'validation' / 'svg_quality_report.json').write_text('{}', encoding='utf-8')
        (project / 'exports').mkdir()
        (project / 'exports' / 'demo_20261015_120000.pptx').write_bytes(b'pk')
        (project / 'confirm_ui').mkdir()
        (project / 'confirm_ui' / 'session.json').write_text(
            json.dumps({'status': 'waiting_agent', 'current_stage': 'stage2'}),
            encoding='utf-8',
        )
        payload = self.client.get(f'/api/tasks/{self.task_id}/progress').get_json()
        self.assertEqual(payload['status'], 'processing')
        self.assertEqual([s['name'] for s in payload['slides']], ['P01.svg', 'P02.svg'])
        self.assertTrue(payload['quality']['report_exists'])
        self.assertEqual(payload['exports'][0]['name'], 'demo_20261015_120000.pptx')
        self.assertEqual(payload['confirm'], {'status': 'waiting_agent', 'current_stage': 'stage2'})

    def test_slide_and_export_file_routes(self) -> None:
        project = self._attach_project('demo_20261016')
        (project / 'svg_output').mkdir(parents=True)
        (project / 'svg_output' / '01_cover.svg').write_text('<svg>page</svg>', encoding='utf-8')
        (project / 'exports').mkdir()
        (project / 'exports' / 'out.pptx').write_bytes(b'pk')
        slide = self.client.get(f'/api/tasks/{self.task_id}/slides/01_cover.svg')
        self.assertEqual(slide.status_code, 200)
        export = self.client.get(f'/api/tasks/{self.task_id}/exports/out.pptx')
        self.assertEqual(export.status_code, 200)
        self.assertIn('attachment', export.headers['Content-Disposition'])
        for response in (slide, export):
            response.get_data()
            response.close()  # release file handles before tempdir cleanup on Windows
        for url in (
            f'/api/tasks/{self.task_id}/slides/notes.txt',
            f'/api/tasks/{self.task_id}/slides/../task.json',
            f'/api/tasks/{self.task_id}/exports/evil.exe',
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_feedback_roundtrip_and_validation(self) -> None:
        self.assertEqual(
            self.client.get(f'/api/tasks/{self.task_id}/feedback').get_json(),
            {'exists': False},
        )
        self.assertEqual(
            self.client.post(f'/api/tasks/{self.task_id}/feedback', json={'rating': 6}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(f'/api/tasks/{self.task_id}/feedback', json={'wants_revision': 'yes'}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(f'/api/tasks/{self.task_id}/feedback', json={
                'rating': 4, 'comment': '不错', 'wants_revision': True,
            }).status_code,
            200,
        )
        feedback = self.client.get(f'/api/tasks/{self.task_id}/feedback').get_json()
        self.assertEqual(feedback['rating'], 4)
        self.assertEqual(feedback['comment'], '不错')
        self.assertTrue(feedback['wants_revision'])
        self.assertEqual(feedback['schema_version'], 1)


class AgentSurfaceTests(unittest.TestCase):
    """The JSON surface an agent uses: read run state, answer one request."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.project = self.projects_root / 'demo_ppt169_20261102'
        self.project.mkdir()
        agent_bridge.start_run(self.project, task='t20261102-090000-abcd')
        agent_bridge.enter_stage(self.project, 'execute', label='绘制页面 2/6')
        agent_bridge.set_progress(self.project, 2, 6)

    def test_project_list_reports_live_state(self) -> None:
        payload = self.client.get('/api/projects').get_json()
        self.assertEqual(len(payload['projects']), 1)
        row = payload['projects'][0]
        self.assertEqual(row['slug'], 'demo_ppt169_20261102')
        self.assertEqual(row['state'], 'running')
        self.assertEqual(row['stage'], 'execute')
        self.assertEqual(row['stage_label'], '绘制页面 2/6')
        self.assertEqual(row['progress'], {'done': 2, 'total': 6, 'unit': 'page'})
        self.assertEqual(row['task_id'], 't20261102-090000-abcd')

    def test_project_view_carries_events_and_inbox(self) -> None:
        request = agent_bridge.open_request(
            self.project,
            kind='confirm',
            title='选择方向',
            options=[{'id': 'a', 'label': 'A'}, {'id': 'b', 'label': 'B'}],
        )
        payload = self.client.get('/api/projects/demo_ppt169_20261102').get_json()
        self.assertEqual(payload['status']['state'], 'waiting_user')
        self.assertTrue(payload['events'])
        self.assertEqual(payload['events'][-1]['type'], 'ask/open')
        self.assertEqual(len(payload['requests']), 1)
        self.assertEqual(payload['requests'][0]['request']['id'], request['id'])
        self.assertIsNone(payload['requests'][0]['response'])

    def test_answer_through_the_project_slug(self) -> None:
        request = agent_bridge.open_request(self.project, kind='confirm', title='T')
        url = f"/api/projects/demo_ppt169_20261102/requests/{request['id']}"
        response = self.client.post(url, json={'choice': ['a']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['response']['status'], 'answered')
        self.assertEqual(self.client.get('/api/projects').get_json()['projects'][0]['state'], 'running')
        # A second answer is a conflict, never an edit.
        self.assertEqual(self.client.post(url, json={'choice': ['b']}).status_code, 409)

    def test_answer_through_the_task_id(self) -> None:
        task_id = self.client.post('/api/tasks', json={'topic': '答题测试'}).get_json()['task_id']
        self.client.post(f'/api/tasks/{task_id}/submit')
        agent_bridge.start_run(self.project, takeover=True, task=task_id)
        request = agent_bridge.open_request(self.project, kind='choice', title='T')
        response = self.client.post(
            f"/api/tasks/{task_id}/requests/{request['id']}",
            json={'choice': ['x'], 'text': '备注'},
        )
        self.assertEqual(response.status_code, 200)
        stored = agent_bridge.read_response(self.project, request['id'])
        self.assertEqual(stored['choice'], ['x'])
        self.assertEqual(stored['text'], '备注')
        self.assertEqual(stored['answered_by_surface'], 'web')

    def test_bad_slug_and_request_id_are_refused(self) -> None:
        self.assertEqual(self.client.get('/api/projects/..').status_code, 404)
        self.assertEqual(self.client.get('/api/projects/not-a-project').status_code, 404)
        request = agent_bridge.open_request(self.project, kind='confirm', title='T')
        bad = f'/api/projects/demo_ppt169_20261102/requests/..%2F..%2Ftask'
        self.assertEqual(self.client.post(bad, json={}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
