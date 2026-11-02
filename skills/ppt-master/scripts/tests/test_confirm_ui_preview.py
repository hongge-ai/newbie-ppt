#!/usr/bin/env python3
"""PPT Master - Confirmation Preview Routes

The Stage-1 template picker renders each candidate's prototype roster, so it
must serve workspace files without escaping the registered library root.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_confirm_ui_preview

Dependencies:
    flask
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from confirm_ui import server  # noqa: E402


class TemplatePreviewRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name) / 'demo_ppt169_20261102'
        (self.project / 'confirm_ui').mkdir(parents=True)
        with patch.object(server.threading.Thread, 'start'):
            self.app = server.create_app(str(self.project), idle_timeout=0)
        self.app.config['TESTING'] = True
        self.client = self.app.test_client()

    def test_layout_roster_lists_real_pages(self) -> None:
        payload = self.client.get('/api/template-roster/layout/presentation_core').get_json()
        self.assertEqual(payload['kind'], 'layout')
        self.assertTrue(payload['roster'])
        self.assertTrue(payload['roster'][0]['name'].endswith('.svg'))
        self.assertIn('/api/template-file/layout/presentation_core/templates/', payload['roster'][0]['url'])
        self.assertIn('/api/template-file/layout/presentation_core/images', payload['images_prefix'])

    def test_brand_has_no_roster_but_identity(self) -> None:
        payload = self.client.get('/api/template-roster/brand/中国电信').get_json()
        self.assertEqual(payload['roster'], [])
        self.assertEqual(payload['frontmatter'].get('kind'), 'brand')

    def test_roster_file_route_serves_the_prototype(self) -> None:
        response = self.client.get(
            '/api/template-file/layout/presentation_core/templates/01_title_slide.svg')
        self.assertEqual(response.status_code, 200)
        self.assertIn('<svg', response.get_data(as_text=True))
        response.close()

    def test_unknown_or_escaping_paths_are_refused(self) -> None:
        self.assertEqual(self.client.get('/api/template-roster/layout/no-such-layout').status_code, 404)
        self.assertEqual(self.client.get('/api/template-roster/office/presentation_core').status_code, 404)
        escaped = self.client.get(
            '/api/template-file/layout/presentation_core/../../../pyproject.toml')
        self.assertEqual(escaped.status_code, 404)


if __name__ == '__main__':
    unittest.main()
