#!/usr/bin/env python3
"""PPT Master - Workbench Surface Mount Tests

Prove that the per-project confirmation and preview APIs are served by the one
resident workbench app, legacy surface roots redirect to native Workbench SPA
routes, retired spec_review UI routes are removed, and mounted APIs can never
end the shared process.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_workbench_mount

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

import agent_bridge  # noqa: E402
from workbench import server  # noqa: E402


SLUG = 'demo_ppt169_20261102'


class SurfaceMountTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.projects_root = Path(self.temporary.name) / 'projects'
        self.projects_root.mkdir(parents=True)
        self.project = self.projects_root / SLUG
        (self.project / 'svg_output').mkdir(parents=True)
        (self.project / 'svg_output' / 'P01.svg').write_text(
            "<svg xmlns='http://www.w3.org/2000/svg'/>", encoding='utf-8',
        )
        (self.project / 'images').mkdir()
        (self.project / 'images' / 'logo.png').write_bytes(b'png')
        (self.project / 'design_spec.md').write_text('# Spec\n', encoding='utf-8')
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.projects_root), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def _get(self, path: str):
        response = self.client.get(f'/p/{SLUG}{path}')
        response.get_data()
        response.close()
        return response

    def test_legacy_surface_roots_redirect_to_workbench_spa(self) -> None:
        for kind in ('confirm', 'preview'):
            with self.subTest(kind=kind):
                response = self._get(f'/{kind}/')
                self.assertEqual(response.status_code, 302)
                self.assertEqual(
                    response.headers['Location'],
                    f'/#/project/{SLUG}/{kind}',
                )
                self.assertEqual(response.headers.get('Cache-Control'), 'no-store')

        slide_resp = self._get('/preview/?slide=P01.svg')
        self.assertEqual(slide_resp.status_code, 302)
        self.assertEqual(
            slide_resp.headers['Location'],
            f'/#/project/{SLUG}/preview?slide=P01.svg',
        )

    def test_task_bound_project_redirects_to_task_focus_route(self) -> None:
        task_id = 't20261120-100000-beef'
        task_dir = self.projects_root / '.workbench' / 'tasks' / task_id
        task_dir.mkdir(parents=True)
        (task_dir / server.TASK_FILE_NAME).write_text(
            json.dumps({'schema_version': 1, 'task_id': task_id, 'status': 'processing'}),
            encoding='utf-8',
        )
        agent_bridge.start_run(self.project, task=task_id)

        response = self._get('/preview/?slide=P01.svg')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response.headers['Location'],
            f'/#/task/{task_id}/preview?slide=P01.svg',
        )

    def test_spec_surface_is_retired_from_mount(self) -> None:
        self.assertEqual(self._get('/spec/').status_code, 404)
        self.assertEqual(self._get('/spec/api/state').status_code, 404)

    def test_apis_answer_under_the_prefix(self) -> None:
        slides = self._get('/preview/api/slides').get_json()
        self.assertEqual([item['name'] for item in slides['slides']], ['P01.svg'])
        self.assertIn('current_stage', self._get('/confirm/api/session').get_json())

    def test_page_svg_image_reference_resolves(self) -> None:
        # Page SVGs say ../images/x.png; from /p/<slug>/preview/ that is
        # /p/<slug>/images/x.png, so the mount routes it into the preview app.
        response = self._get('/images/logo.png')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b'png')

    def test_a_mounted_view_cannot_end_the_process(self) -> None:
        for kind in ('confirm', 'preview'):
            with self.subTest(kind=kind):
                response = self.client.post(f'/p/{SLUG}/{kind}/api/shutdown', json={})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json()['status'], 'embedded')
        # The workbench itself is untouched by every one of those calls.
        self.assertEqual(self.client.get('/api/health').get_json()['status'], 'ok')

    def test_unknown_or_escaping_projects_are_refused(self) -> None:
        self.assertEqual(self.client.get('/p/missing/preview/').status_code, 404)
        self.assertEqual(self.client.get('/p/../preview/').status_code, 404)
        self.assertEqual(self.client.get(f'/p/{SLUG}/nope/').status_code, 404)


if __name__ == '__main__':
    unittest.main()
