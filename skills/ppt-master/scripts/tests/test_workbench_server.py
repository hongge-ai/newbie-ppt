#!/usr/bin/env python3
"""PPT Master - Workbench Server Tests

Exercise the repository-level workbench app factory without running a server.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_workbench_server

Dependencies:
    flask
"""

import io
import hashlib
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
            'requirements': {'feel': '克制专业，像咨询报告'},
            'params': {'canvas': 'ppt43', 'page_count': 10, 'speaker_notes': True},
        })
        self.assertEqual(response.status_code, 200)
        task = self.client.get(f'/api/tasks/{task_id}').get_json()
        self.assertEqual(task['display_title'], 'Q3 汇报')
        self.assertNotIn('requirements', task)
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

    def test_title_stays_editable_after_submission(self) -> None:
        task_id = self._create('做一个季度汇报')
        self.client.post(f'/api/tasks/{task_id}/submit')
        response = self.client.patch(
            f'/api/tasks/{task_id}', json={'display_title': 'Q3 经营分析'},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(
            self.client.get(f'/api/tasks/{task_id}').get_json()['display_title'],
            'Q3 经营分析',
        )
        # Every other user-domain field is still frozen.
        self.assertEqual(
            self.client.patch(
                f'/api/tasks/{task_id}',
                json={'display_title': 'X', 'topic': 'y'},
            ).status_code,
            409,
        )

    def test_stage1_confirm_supports_free_design_and_templates(self) -> None:
        task = server._default_task('t20260101-000000-abcd', '主题', None)
        payload, error = server._stage1_confirm_payload(task, {
            'contract': {},
            'template_mode': 'free_design',
            'selection_keys': [],
            'options_sha256': 'a' * 64,
        })
        self.assertIsNone(error)
        self.assertEqual(payload['template_selection'], {
            'mode': 'free_design',
            'selection_keys': [],
        })
        # Free design cannot carry workspace keys.
        payload, error = server._stage1_confirm_payload(task, {
            'contract': {},
            'template_mode': 'free_design',
            'selection_keys': ['library:brand:accenture'],
            'options_sha256': 'a' * 64,
        })
        self.assertIsNone(payload)
        self.assertIn('free_design cannot carry', error)
        # Templates mode requires at least one key.
        payload, error = server._stage1_confirm_payload(task, {
            'contract': {},
            'template_mode': 'templates',
            'selection_keys': [],
            'options_sha256': 'a' * 64,
        })
        self.assertIsNone(payload)
        self.assertIn('at least one', error)
        # Valid template selection passes through unchanged.
        payload, error = server._stage1_confirm_payload(task, {
            'contract': {},
            'template_mode': 'templates',
            'selection_keys': ['library:layout:presentation_core', 'library:brand:mckinsey'],
            'options_sha256': 'a' * 64,
        })
        self.assertIsNone(error)
        self.assertEqual(payload['template_selection'], {
            'mode': 'templates',
            'selection_keys': ['library:layout:presentation_core', 'library:brand:mckinsey'],
        })

    def test_confirm_route_persists_free_design_receipt(self) -> None:
        task_id = self._create('黑土地科普课')
        self.client.post(f'/api/tasks/{task_id}/submit')
        project = self.projects_root / 'heitudi_demo_20261105'
        (project / 'confirm_ui').mkdir(parents=True)
        agent_bridge.start_run(project, task=task_id)
        agent_bridge.enter_stage(project, 'confirm_stage1', label='等待确认')
        (project / 'confirm_ui' / 'recommendations.stage1.json').write_text(
            json.dumps({
                'stage': 'stage1',
                'lang': 'zh',
                'primary_language': 'zh-CN',
                'display_title': '黑土地：一厘米四百年',
                'template_options': {
                    'schema_version': 1,
                    'phase': 'template',
                    'lang': 'zh',
                    'default_mode': 'free_design',
                    'explicit_workspace_roots': [],
                },
                'recommend': {'canvas': 'ppt169'},
                'audience': {'value': '中学生'},
            }),
            encoding='utf-8',
        )
        proposal = self.client.get(f'/api/tasks/{task_id}/proposal').get_json()
        self.assertTrue(proposal['available'])
        sha = proposal['template_options']['options_sha256']
        resp = self.client.post(f'/api/tasks/{task_id}/confirm', json={
            'display_title': '黑土地：一厘米四百年',
            'preferred_visual_style': 'photo-editorial',
            'contract': {'audience': '中学生与公众'},
            'template_mode': 'free_design',
            'selection_keys': [],
            'options_sha256': sha,
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())
        selection = json.loads(
            (project / 'confirm_ui' / 'template_selection.json').read_text(encoding='utf-8')
        )
        self.assertEqual(selection['mode'], 'free_design')
        self.assertEqual(selection['selections'], [])
        self.assertEqual(self.client.get(f'/api/projects/{project.name}/selection-preview').status_code, 404)

    def test_curated_task_installs_only_the_chosen_deck_at_outline_confirmation(self):
        from confirm_ui import outline_store

        examples = self.client.get('/api/examples').get_json()['examples']
        example = examples[0]
        self.assertEqual(example['id'], 'bauhaus')
        self.assertEqual(len(example['pages']), 13)
        for i in range(1, 14):
            with self.client.get(f'/static/examples/bauhaus/{i:02}.webp') as image:
                self.assertEqual(image.status_code, 200)
        self.assertEqual(self.client.get('/api/tasks').get_json()['tasks'], [])
        self.assertEqual(self.client.post('/api/tasks', json={'example_id': '../unknown'}).status_code, 400)
        task_id = self.client.post('/api/tasks', json={'example_id': 'bauhaus'}).get_json()['task_id']
        path = f'/api/tasks/{task_id}'
        self.assertEqual(self.client.post(path + '/submit').status_code, 400)
        self.assertEqual(self._upload(task_id, 'brief.txt').status_code, 201)
        self.assertEqual(self.client.post(path + '/submit', json={}).status_code, 200)
        self.assertEqual(self.client.get(path).get_json()['example_id'], 'bauhaus')
        project = self.projects_root / 'example_run'
        project.mkdir()
        agent_bridge.start_run(project, task=task_id)
        outline_store.publish_outline(project, '# Brief\n\n## 第 1 页 [封面] Brief\n- First point')
        for _ in range(2):
            response = self.client.post(path + '/outline/confirm', json={})
            self.assertEqual(response.status_code, 200, response.get_json())
        receipt = json.loads((project / 'template_install.json').read_text('utf-8'))
        self.assertIn('design_spec.deck.bauhaus.md', receipt['installed_specs'])
        self.assertEqual(len(list((project / 'templates').glob('*.svg'))), 10)
        self.assertEqual(self.client.post(path + '/confirm', json={}).status_code, 409)

    def test_landscape_source_example_keeps_its_canvas_and_layouts_on_retry(self):
        from confirm_ui import outline_store

        examples = self.client.get('/api/examples').get_json()['examples']
        for example in examples:
            frame = server.CANVAS_FORMATS[example['canvas']]
            self.assertGreater(frame['width'], frame['height'], example['id'])
        example_id = 'custom_1920x600_autumn_web_banner'
        task_id = self.client.post('/api/tasks', json={
            'example_id': example_id, 'topic': 'A seasonal programme',
        }).get_json()['task_id']
        path = f'/api/tasks/{task_id}'
        self.assertEqual(self.client.get(path).get_json()['params']['canvas'], 'webbanner')
        self.client.post(path + '/submit', json={})
        project = self.projects_root / 'banner_run'
        project.mkdir()
        agent_bridge.start_run(project, task=task_id)
        outline_store.publish_outline(project, '# Programme\n\n## 第 1 页 [封面] Programme\n- Opening')
        for _ in range(2):
            response = self.client.post(path + '/outline/confirm', json={})
            self.assertEqual(response.status_code, 200, response.get_json())
        installed = json.loads((project / 'example_reference.json').read_text('utf-8'))
        self.assertEqual(installed['example_id'], example_id)
        self.assertEqual(installed['viewBox'], '0 0 1920 600')
        self.assertTrue(all('<svg' in slide['svg'] for slide in installed['slides']))

    def test_example_submission_dispatches_to_connected_agent(self):
        agent = self.client.post('/api/agents/register', json={'name': 'Connected AI'}).get_json()
        task_id = self.client.post('/api/tasks', json={
            'example_id': 'bauhaus', 'topic': 'Reading a railway map',
        }).get_json()['task_id']
        path = '/api/tasks/' + task_id
        self.assertEqual(self.client.post(path + '/submit', json={}).status_code, 200)
        detail = self.client.get(path).get_json()
        self.assertEqual(detail['assignment']['agent_id'], agent['agent_id'])

    def test_plan_review_is_due_only_with_a_stage2_plan(self) -> None:
        project = self.projects_root / 'plan_demo'
        confirm = project / 'confirm_ui'
        confirm.mkdir(parents=True)
        self.assertEqual(
            server._plan_state(project),
            {'review_due': False, 'confirmed': False},
        )
        (confirm / 'result.json').write_text(
            json.dumps({'stage': 'stage1', 'status': 'stage1-confirmed'}),
            encoding='utf-8',
        )
        self.assertFalse(server._plan_state(project)['review_due'])
        (confirm / 'recommendations.stage2.json').write_text(
            json.dumps({'stage': 'stage2'}), encoding='utf-8',
        )
        self.assertEqual(
            server._plan_state(project),
            {'review_due': True, 'confirmed': False},
        )
        (confirm / 'result.json').write_text(
            json.dumps({'stage': 'final', 'status': 'confirmed'}),
            encoding='utf-8',
        )
        self.assertEqual(
            server._plan_state(project),
            {'review_due': False, 'confirmed': True},
        )

    def test_proposal_carries_the_ai_title(self) -> None:
        task = server._default_task('t20260101-000000-abcd', '校园咖啡店改造', None)
        payload = server._proposal_payload(task, {
            'stage': 'stage1',
            'display_title': 'Q3 经营分析汇报',
            'audience': {'value': '班子'},
        }, 200)
        self.assertTrue(payload['available'])
        self.assertEqual(payload['title'], 'Q3 经营分析汇报')
        self.assertEqual(payload['contract']['audience'], '班子')
        meta = payload['template_meta']
        self.assertIn('library:layout:presentation_core', meta)
        self.assertEqual(meta['library:layout:presentation_core']['title'], '通用商务演示')
        self.assertEqual(meta['library:layout:presentation_core']['canvas_format'], 'ppt169')
        self.assertEqual(meta['library:brand:mckinsey']['primary_color'], '#051C2C')
        empty = server._proposal_payload(task, {'stage': 'stage1'}, 200)
        self.assertEqual(empty['title'], '')

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
        self.assertIn('examples', data)
        self.assertNotIn('visual_styles', data)
        for asset, marker in (
            ('/static/style_slides.js', 'WorkbenchStyleSlides'),
            ('/static/slide_preview.js', 'WorkbenchSlidePreview'),
            ('/static/stage2_confirm.js', 'WorkbenchConfirmView'),
        ):
            with self.subTest(asset=asset):
                resp = self.client.get(asset)
                self.assertEqual(resp.status_code, 200)
                body = resp.get_data(as_text=True)
                resp.close()
                self.assertIn(marker, body)

    def test_proposal_needs_a_project(self) -> None:
        task_id = self._create()
        self.client.post(f'/api/tasks/{task_id}/submit')
        proposal = self.client.get(f'/api/tasks/{task_id}/proposal').get_json()
        self.assertFalse(proposal['available'])
        self.assertTrue(proposal['reason'])
        response = self.client.post(
            f'/api/tasks/{task_id}/confirm',
            json={'contract': {}, 'template_mode': 'free_design'},
        )
        self.assertEqual(response.status_code, 409)


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

    def test_export_desktop_actions(self) -> None:
        project = self._attach_project('desktop_actions')
        directory = project / 'exports'
        directory.mkdir()
        source = directory / 'out.pptx'
        source.write_bytes(b'demo deck')
        base = f'/api/tasks/{self.task_id}/exports'
        origin = {'Origin': 'http://localhost'}
        self.assertEqual(self.client.get(f'{base}/out.pptx/open').status_code, 405)
        self.assertEqual(self.client.post(f'{base}/out.pptx/open', json={}).status_code, 403)
        self.assertEqual(self.client.post(f'{base}/missing.pptx/open', headers=origin, json={}).status_code, 404)
        with patch.object(server.os, 'startfile', create=True) as win_open, patch.object(server.subprocess, 'run') as run:
            self.assertTrue(self.client.post(f'{base}/out.pptx/open', headers=origin, json={}).json['opened'])
            if server.os.name == 'nt':
                win_open.assert_called_once_with(str(source))
            else:
                self.assertEqual(run.call_args.args[0][-1], str(source))
            target = project / '我的副本.pptx'
            run.return_value.stdout = json.dumps(str(target)).encode()
            self.assertTrue(self.client.post(f'{base}/out.pptx/save-as', headers=origin, json={}).json['saved'])
            self.assertEqual(target.read_bytes(), source.read_bytes())
            run.return_value.stdout = b'null'
            self.assertFalse(self.client.post(f'{base}/out.pptx/save-as', headers=origin, json={}).json['saved'])

    def test_slide_progress_follows_previewable_file_revisions(self) -> None:
        project = self._attach_project('preview_incremental')
        slides = project / 'svg_output'
        slides.mkdir()
        first, second = slides / 'P01.svg', slides / 'P02.svg'
        first.write_text('<svg>', encoding='utf-8')
        second.write_text('<svg/>', encoding='utf-8')
        url = f'/api/tasks/{self.task_id}/progress'
        partial = self.client.get(url).get_json()
        self.assertEqual([slide['name'] for slide in partial['slides']], ['P02.svg'])
        first.write_text('<svg><text>First</text></svg>', encoding='utf-8')
        complete = self.client.get(url).get_json()
        self.assertEqual([slide['name'] for slide in complete['slides']], ['P01.svg', 'P02.svg'])

    @unittest.skipUnless(sys.platform == 'win32', 'PowerPoint preview is Windows-only')
    def test_preview_views_share_cached_pages_and_prefer_finished_export(self) -> None:
        from workbench.powerpoint_preview import PreviewRenderer

        project = self._attach_project('rendered_pages')
        slides = project / 'svg_output'
        slides.mkdir()
        (slides / '02_read.svg').write_text('<svg/>', encoding='utf-8')
        project_url = f'/api/projects/{project.name}/page-previews'
        task_url = f'/api/tasks/{self.task_id}/progress?preview=1'
        with patch.object(PreviewRenderer, '_schedule', return_value=True) as schedule:
            pending = self.client.get(project_url).json
            self.assertIsNone(pending['pages'][0]['image'])
            self.assertEqual(pending['pages'][0]['number'], 2)
            cache = self.projects_root / '.workbench' / 'page-previews' / project.name
            draft = cache / schedule.call_args.args[-1]
            draft.mkdir(parents=True)
            (draft / '1.webp').write_bytes(b'draft')
            first = self.client.get(task_url).json['page_preview']
            self.assertEqual(first, self.client.get(project_url).json)
            self.assertEqual(first['source'], 'draft')
            (project / 'exports').mkdir()
            (project / 'exports' / 'final.pptx').write_bytes(b'placeholder')
            updating = self.client.get(project_url).json
            self.assertEqual(updating['pages'][0]['image'], first['pages'][0]['image'])
            final = cache / schedule.call_args.args[-1]
            final.mkdir()
            (final / 'count').write_text('2')
            (final / '2.webp').write_bytes(b'final')
            result = self.client.get(project_url).json
            self.assertEqual(result['source'], 'final')
            self.assertEqual(result['pages'][1]['name'], '02_read.svg')
            image = self.client.get(project_url + '/' + result['pages'][1]['image'])
            try:
                self.assertEqual(image.get_data(), b'final')
            finally:
                image.close()
            self.assertEqual(self.client.get(task_url).json['page_preview'], result)

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


class OutlineAndDelegationTests(unittest.TestCase):
    """Step-1 outline review lifecycle, wait CLI, and Stage-2 direct-generation delegation."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()
        self.task_id = self.client.post(
            '/api/tasks', json={'topic': '黑土地科普课'},
        ).get_json()['task_id']
        self.client.post(f'/api/tasks/{self.task_id}/submit')
        self.project = self.projects_root / 'heitudi_20261118'
        (self.project / 'confirm_ui').mkdir(parents=True)
        agent_bridge.start_run(self.project, task=self.task_id)
        agent_bridge.enter_stage(self.project, 'outline', label='撰写大纲')

    def test_review_reminder_does_not_create_a_second_answer_form(self) -> None:
        url = f'http://127.0.0.1:7070/#/task/{self.task_id}'
        agent_bridge.open_request(self.project, kind='confirm', title='请在「① 内容大纲」确认', url=url)
        progress_url = f'/api/tasks/{self.task_id}/progress'
        progress = self.client.get(progress_url).get_json()
        self.assertEqual(progress['requests'], [])
        self.assertIsNone(progress['attention'])
        self.assertIsNone(self.client.get('/api/tasks').get_json()['tasks'][0]['attention'])

        question = agent_bridge.open_request(
            self.project, kind='confirm', title='Include the appendix?', url=url,
        )
        progress = self.client.get(progress_url).get_json()
        self.assertEqual([item['request']['id'] for item in progress['requests']], [question['id']])
        self.assertEqual(progress['attention'], 'answer')

    def test_image_progress_counts_planned_assets_as_files_become_readable(self) -> None:
        from PIL import Image

        def progress():
            return self.client.get(f'/api/tasks/{self.task_id}/progress').get_json()['image_progress']

        self.assertIsNone(progress()['total'])
        directory = self.project / 'images'
        directory.mkdir()
        manifest = directory / 'image_prompts.json'
        manifest.write_text(json.dumps({'items': [
            {'filename': 'cover.jpg', 'status': 'Pending', 'alt_text': 'Waterfall'},
            {'filename': 'closing.png', 'status': 'Failed'},
            {'filename': '../outside.jpg', 'status': 'Generated'},
        ]}), encoding='utf-8')
        self.assertEqual(progress(), {'total': 2, 'ready': [], 'failed': 1, 'manual': 0})
        (self.project / 'spec_lock.md').write_text(
            '## images\n- cover: images/cover.jpg | source=ai | crop=adaptive\n'
            '- river: images/river.jpg | source=web | crop=adaptive\n', encoding='utf-8')
        Image.new('RGB', (32, 32)).save(directory / 'river.jpg')
        Image.new('RGB', (32, 32)).save(directory / 'unplanned.jpg')
        (directory / 'cover.jpg').write_bytes(b'partial')
        partial = progress()
        self.assertEqual(partial['total'], 3)
        self.assertEqual([r['name'] for r in partial['ready']], ['river.jpg'])
        Image.new('RGB', (32, 32)).save(directory / 'cover.jpg')
        self.assertEqual([r['name'] for r in progress()['ready']], ['cover.jpg', 'river.jpg'])

    def test_outline_edit_revise_wait_and_confirm_lifecycle(self) -> None:
        from confirm_ui import outline_store
        from confirm_ui import wait as confirm_wait

        # Missing outline before agent publishes round 1
        initial = self.client.get(f'/api/tasks/{self.task_id}/outline').get_json()
        self.assertFalse(initial['available'])
        self.assertEqual(initial['status'], 'missing')

        # Agent writes and publishes round 1
        sample_md = (
            '# 黑土地：一厘米四百年的大地密码\n\n'
            '> 面向中学生与公众的地球科学科普课\n\n'
            '## 第 1 页 [封面] 黑土地：一厘米四百年的大地密码\n'
            '- **开场悬念**：为什么捏一把黑土能攥出油花？\n\n'
            '## 第 2 页 [正文] 世界四大黑土区分布\n'
            '- 中国东北平原、乌克兰平原、美国密西西比河流域、潘帕斯草原\n'
        )
        published = outline_store.publish_outline(self.project, sample_md)
        self.assertEqual(published['status'], 'ready')
        self.assertEqual(published['round'], 1)
        self.assertEqual(published['slide_count'], 2)
        self.assertEqual(self.client.get('/api/tasks').get_json()['tasks'][0]['attention'], 'outline')
        self.assertEqual(self.client.get(f'/api/tasks/{self.task_id}/progress').get_json()['attention'], 'outline')

        progress = self.client.get(f'/api/tasks/{self.task_id}/progress').get_json()
        self.assertEqual(progress['outline']['status'], 'ready')
        self.assertEqual(progress['outline']['slide_count'], 2)

        # User edits directly (adds a 3rd page and renames title)
        edited_md = sample_md + '\n## 第 3 页 [总结] 梨树模式守护耕地大熊猫\n- 秸秆覆盖免耕少耕\n'
        put_resp = self.client.put(
            f'/api/tasks/{self.task_id}/outline',
            json={'markdown': edited_md, 'display_title': '黑土地保护科普课'},
        )
        self.assertEqual(put_resp.status_code, 200, put_resp.get_json())
        self.assertEqual(put_resp.get_json()['slide_count'], 3)
        self.assertEqual(
            self.client.get(f'/api/tasks/{self.task_id}').get_json()['display_title'],
            '黑土地保护科普课',
        )

        # User highlights formatted text ("开场悬念：为什么捏一把黑土") + adds global note
        rev_resp = self.client.post(
            f'/api/tasks/{self.task_id}/outline/revise',
            json={
                'comments': [{
                    'id': 'c_1',
                    'slide': 1,
                    'slide_title': '封面',
                    'quote': '开场悬念：为什么捏一把黑土',
                    'comment': '加上形成 1 厘米需要 200-400 年的对比',
                }],
                'global_note': '整体语气更生动一些',
            },
        )
        self.assertEqual(rev_resp.status_code, 200, rev_resp.get_json())
        self.assertEqual(rev_resp.get_json()['status'], 'revising')

        # Direct edits and duplicate revisions are blocked (409) while AI is revising
        self.assertEqual(
            self.client.put(
                f'/api/tasks/{self.task_id}/outline', json={'markdown': edited_md},
            ).status_code,
            409,
        )

        # wait.py --stage outline wakes immediately on status == revising
        buf = io.StringIO()
        with patch('sys.stdout', buf):
            code = confirm_wait.wait_for_stage(self.project, stage='outline', timeout=2)
        self.assertEqual(code, 0)
        woke = json.loads(buf.getvalue())
        self.assertEqual(woke['status'], 'revising')
        self.assertEqual(len(woke['pending_revision']['comments']), 1)

        # Agent revises outline.md and republishes (round 2)
        revised_md = edited_md.replace('攥出油花？', '攥出油花，形成 1 厘米却要 400 年？')
        (self.project / 'outline.md').write_text(revised_md, encoding='utf-8')
        republished = outline_store.publish_outline(self.project)
        self.assertEqual(republished['status'], 'ready')
        self.assertEqual(republished['round'], 2)

        # User confirms outline
        conf_resp = self.client.post(f'/api/tasks/{self.task_id}/outline/confirm', json={})
        self.assertEqual(conf_resp.status_code, 200, conf_resp.get_json())
        self.assertEqual(conf_resp.get_json()['status'], 'confirmed')

        buf2 = io.StringIO()
        with patch('sys.stdout', buf2):
            code2 = confirm_wait.wait_for_stage(self.project, stage='outline', timeout=2)
        self.assertEqual(code2, 0)
        self.assertEqual(json.loads(buf2.getvalue())['status'], 'confirmed')

    def test_stage1_confirm_records_stage2_delegation_flag(self) -> None:
        from confirm_ui import outline_store
        from confirm_ui import wait as confirm_wait

        outline_store.publish_outline(
            self.project,
            '# 黑土地科普\n\n> 面向初中生的科普课件\n\n## 第 1 页 [封面] 黑土地科普\n- 核心导入\n',
        )
        self.client.post(f'/api/tasks/{self.task_id}/outline/confirm', json={})
        agent_bridge.enter_stage(self.project, 'confirm_stage1')
        (self.project / 'confirm_ui' / 'recommendations.stage1.json').write_text(
            json.dumps({
                'stage': 'stage1',
                'lang': 'zh',
                'primary_language': 'zh-CN',
                'display_title': '黑土地科普',
                'template_options': {
                    'schema_version': 1,
                    'phase': 'template',
                    'lang': 'zh',
                    'default_mode': 'free_design',
                    'explicit_workspace_roots': [],
                },
                'recommend': {'canvas': 'ppt169'},
            }),
            encoding='utf-8',
        )
        proposal = self.client.get(f'/api/tasks/{self.task_id}/proposal').get_json()
        self.assertEqual(proposal['outline']['status'], 'confirmed')
        self.assertEqual(proposal['outline_preview']['cover_title'], '黑土地科普')
        sha = proposal['template_options']['options_sha256']

        # Unknown visual_style is rejected cleanly
        bad_style = self.client.post(f'/api/tasks/{self.task_id}/confirm', json={
            'contract': {},
            'template_mode': 'free_design',
            'selection_keys': [],
            'options_sha256': sha,
            'preferred_visual_style': 'nonexistent-style',
        })
        self.assertEqual(bad_style.status_code, 400)

        resp = self.client.post(f'/api/tasks/{self.task_id}/confirm', json={
            'contract': {},
            'template_mode': 'free_design',
            'selection_keys': [],
            'options_sha256': sha,
            'skip_stage2_review': True,
            'preferred_visual_style': 'chalkboard',
        })
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertTrue(resp.get_json()['delegate_stage2'])
        self.assertEqual(resp.get_json()['preferred_visual_style'], 'chalkboard')

        buf = io.StringIO()
        with patch('sys.stdout', buf):
            code = confirm_wait.wait_for_stage(self.project, stage='stage1', timeout=2)
        self.assertEqual(code, 0)
        waited = json.loads(buf.getvalue())
        self.assertEqual(waited['stage'], 'stage1')
        self.assertTrue(waited['delegate_stage2'])
        self.assertEqual(waited['preferred_visual_style'], 'chalkboard')

        after_confirm = self.client.get(f'/api/tasks/{self.task_id}/proposal').get_json()
        self.assertFalse(after_confirm['available'])
        self.assertTrue(after_confirm['stage1_confirmed'])
        self.assertTrue(after_confirm['delegate_stage2'])
        self.assertEqual(after_confirm['preferred_visual_style'], 'chalkboard')

        reopened = self.client.post(f'/api/tasks/{self.task_id}/proposal/reopen', json={})
        self.assertEqual(reopened.status_code, 200, reopened.get_json())
        restored = self.client.get(f'/api/tasks/{self.task_id}/proposal').get_json()
        self.assertTrue(restored['available'])
        self.assertEqual(restored['preferred_visual_style'], 'chalkboard')


if __name__ == '__main__':
    unittest.main()
