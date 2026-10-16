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
        self.assertEqual(task['params']['profile'], 'quick')
        self.assertEqual(task['template_selection']['mode'], 'free_design')
        self.assertIn('indexes_sha256', task['template_selection'])
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
            {'params': {'profile': 'turbo'}},
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

    def test_template_selection_resolves_roots_from_index(self) -> None:
        task_id = self._create()
        response = self.client.patch(f'/api/tasks/{task_id}', json={
            'template_selection': {
                'mode': 'templates',
                'selections': [{'kind': 'style', 'id': 'consulting-decision'}],
            },
        })
        self.assertEqual(response.status_code, 200)
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        selection = task['template_selection']
        self.assertEqual(selection['mode'], 'templates')
        self.assertEqual(len(selection['selections']), 1)
        chosen = selection['selections'][0]
        self.assertEqual(chosen['kind'], 'style')
        expected_root = server._templates_dir() / 'styles' / 'consulting-decision'
        self.assertEqual(chosen['workspace_root'], str(expected_root))
        self.assertTrue(Path(chosen['workspace_root']).is_dir())

    def test_template_selection_rejects_bad_input(self) -> None:
        task_id = self._create()
        for selection in (
            {'mode': 'templates', 'selections': []},
            {'mode': 'free_design', 'selections': [{'kind': 'style', 'id': 'consulting-decision'}]},
            {'mode': 'templates', 'selections': [{'kind': 'office', 'id': 'x'}]},
            {'mode': 'templates', 'selections': [{'kind': 'style', 'id': '../_index'}]},
            {'mode': 'templates', 'selections': [{'kind': 'style', 'id': 'no-such-style'}]},
            {'mode': 'templates', 'selections': [
                {'kind': 'style', 'id': 'consulting-decision'},
                {'kind': 'style', 'id': 'mbb-consulting'},
            ]},
        ):
            with self.subTest(selection=selection):
                response = self.client.patch(f'/api/tasks/{task_id}', json={
                    'template_selection': selection,
                })
                self.assertEqual(response.status_code, 400)

    def test_submit_requires_topic_and_selection_consistency(self) -> None:
        task = server._default_task('t20990101-000000-beef', '标题', None)
        task['topic'] = ' '
        self.assertIn('topic', server._submit_error(task))
        task['topic'] = '有主题'
        task['template_selection']['mode'] = 'templates'
        self.assertIn('selection', server._submit_error(task))
        task['template_selection']['selections'] = [
            {'source': 'library', 'kind': 'style', 'id': 'x', 'workspace_root': '/x'},
        ]
        self.assertIsNone(server._submit_error(task))

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

    def test_agent_writeback_is_visible_without_restart(self) -> None:
        task_id = self._create()
        self.client.post(f'/api/tasks/{task_id}/submit')
        task = json.loads(self._task_file(task_id).read_text(encoding='utf-8-sig'))
        task['status'] = 'processing'
        task['project_dir'] = str(self.projects_root / 'demo_20261015')
        self._task_file(task_id).write_text(
            json.dumps(task, ensure_ascii=False), encoding='utf-8',
        )
        seen = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(seen['status'], 'processing')
        self.assertEqual(seen['project_dir'], task['project_dir'])

    def test_options_endpoint_syncs_canvas_from_config(self) -> None:
        response = self.client.get('/api/options')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(any(item['id'] == 'ppt169' for item in data['canvas']))
        self.assertTrue(data['profiles'])
        self.assertTrue(data['image_policies'])
        self.assertTrue(data['languages'])
        self.assertTrue(data['page_counts'])


class TemplateMarketTests(unittest.TestCase):
    """Market catalog, preview, and the whitelisted workspace file route.

    These read the real bundled template library shipped with the skill.
    """

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

    def test_template_catalog_matches_indexes(self) -> None:
        response = self.client.get('/api/templates')
        self.assertEqual(response.status_code, 200)
        catalog = response.get_json()
        for kind in server.TEMPLATE_KINDS:
            index = server._load_template_index(kind)
            expected_ids = {tid for tid in index if server._safe_template_id(tid)}
            actual_ids = {card['id'] for card in catalog[kind]}
            self.assertEqual(actual_ids, expected_ids, f'kind {kind} mismatch')
            self.assertTrue(actual_ids, f'kind {kind} unexpectedly empty')
        for card in catalog['layout']:
            self.assertIn('workspace_root', card)
            self.assertTrue(Path(card['workspace_root']).is_dir())

    def test_template_file_route_whitelist(self) -> None:
        ok = self.client.get('/templates/layout/presentation_core/templates/01_title_slide.svg')
        self.assertEqual(ok.status_code, 200)
        self.assertIn('svg', ok.headers['Content-Type'])
        for url in (
            '/templates/office/presentation_core/templates/01_title_slide.svg',   # unknown kind
            '/templates/layout/no-such-layout/templates/01_title_slide.svg',      # unknown id
            '/templates/layout/../workbench/server.py',                           # traversal
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)

    def test_template_file_route_serves_cjk_id_and_deck_images(self) -> None:
        svg = self.client.get('/templates/deck/%E4%B8%AD%E5%9B%BD%E7%94%B5%E4%BF%A1/templates/01_cover.svg')
        self.assertEqual(svg.status_code, 200)
        images = self.client.get('/templates/deck/%E4%B8%AD%E5%9B%BD%E7%94%B5%E4%BF%A1/images/logo.png')
        self.assertEqual(images.status_code, 200)

    def test_preview_layout_returns_roster(self) -> None:
        response = self.client.get('/api/templates/layout/presentation_core/preview')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['kind'], 'layout')
        self.assertTrue(payload['roster'], 'layout preview must list roster SVGs')
        first = payload['roster'][0]
        self.assertTrue(first['svg_url'].startswith('/templates/layout/presentation_core/templates/'))
        fetched = self.client.get(first['svg_url'])
        self.assertEqual(fetched.status_code, 200)
        self.assertIn('page_types', payload)

    def test_preview_brand_returns_frontmatter_and_color(self) -> None:
        response = self.client.get('/api/templates/brand/huawei/preview')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['roster'], [], 'brands have no roster')
        self.assertEqual(payload['frontmatter'].get('kind'), 'brand')
        self.assertIn('#', payload.get('primary_color', ''))

    def test_preview_deck_cjk_id(self) -> None:
        response = self.client.get(
            '/api/templates/deck/%E4%B8%AD%E5%9B%BD%E7%94%B5%E4%BF%A1/preview'
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        names = [item['name'] for item in payload['roster']]
        self.assertIn('01_cover.svg', names)
        self.assertTrue(payload['images_url_prefix'].startswith('/templates/deck/'))
        cover = next(item for item in payload['roster'] if item['name'] == '01_cover.svg')
        fetched = self.client.get(cover['svg_url'])
        self.assertEqual(fetched.status_code, 200)
        self.assertIn(b'../images/', fetched.data)

    def test_preview_unknown_template(self) -> None:
        for url in (
            '/api/templates/layout/no-such-layout/preview',
            '/api/templates/brand/../huawei/preview',
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)


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
        """Simulate the agent write-back: attach a project dir to the task."""
        project_path = self.projects_root / project_name
        task = json.loads(self._task_file().read_text(encoding='utf-8-sig'))
        task['status'] = 'processing'
        task['project_dir'] = str(project_path)
        self._task_file().write_text(json.dumps(task, ensure_ascii=False), encoding='utf-8')
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


if __name__ == '__main__':
    unittest.main()
