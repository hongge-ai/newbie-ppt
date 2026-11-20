#!/usr/bin/env python3
"""PPT Master - Confirmation Preview Routes

The Stage-1 template picker renders each candidate's prototype roster, so it
must serve workspace files without escaping the registered library root.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_confirm_ui_preview

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

    def test_confirm_ui_root_returns_json_notice(self) -> None:
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload['service'], 'confirm_ui')

    def test_stage2_confirmation_payload_roundtrip(self) -> None:
        (self.project / 'confirm_ui' / 'recommendations.stage1.json').write_text(
            json.dumps({
                'stage': 'stage1',
                'lang': 'zh',
                'primary_language': 'zh-CN',
                'display_title': 'Stage 2 Roundtrip Deck',
                'template_options': {
                    'schema_version': 1,
                    'phase': 'template',
                    'lang': 'zh',
                    'default_mode': 'free_design',
                    'explicit_workspace_roots': [],
                },
                'recommend': {'canvas': 'ppt169'},
                'audience': {'value': 'Executive team'},
                'communication_intent': {'value': 'Decision review'},
                'audience_outcome': {'value': 'Approve roadmap'},
                'core_message': {'value': 'Ship native workbench UI'},
                'delivery_context': {'value': '15 min live briefing'},
                'artifact_afterlife': {'value': 'Shareable deck'},
                'content_divergence': {'value': ''},
            }, ensure_ascii=False),
            encoding='utf-8',
        )
        s1_rec = self.client.get('/api/recommendations').get_json()
        s1_confirm = self.client.post('/api/confirm', json={
            'stage': 'stage1',
            'primary_language': 'zh-CN',
            'canvas': 'ppt169',
            'audience': 'Executive team',
            'communication_intent': 'Decision review',
            'audience_outcome': 'Approve roadmap',
            'core_message': 'Ship native workbench UI',
            'delivery_context': '15 min live briefing',
            'artifact_afterlife': 'Shareable deck',
            'content_divergence': '',
            'options_sha256': s1_rec['template_options']['options_sha256'],
            'template_selection': {'mode': 'free_design', 'selection_keys': []},
        })
        self.assertEqual(s1_confirm.status_code, 200, s1_confirm.get_json())

        sel = json.loads((self.project / 'confirm_ui' / 'template_selection.json').read_text(encoding='utf-8'))
        candidates = []
        for idx, cid in enumerate(('clarity', 'editorial', 'contrast')):
            candidates.append({
                'id': cid,
                'name': f'Direction {idx + 1}',
                'note': f'Clean visual hierarchy option {idx + 1}.',
                'mode': 'custom',
                'mode_behavior': f'Use pyramid structure tailored for direction {idx + 1}.',
                'visual_style': 'custom',
                'visual_style_behavior': f'Use swiss-minimal layout with accent variant {idx + 1}.',
                'icons': 'tabler-outline',
                'color': {
                    'name': f'Palette {idx + 1}',
                    'palette': {
                        'background': '#FFFFFF',
                        'secondary_bg': '#F4F6F8',
                        'primary': '#1A3A6B',
                        'accent': '#004EA2',
                        'secondary_accent': '#2E6B7E',
                        'body_text': '#1E293B',
                    },
                },
                'typography': {
                    'name': 'Microsoft YaHei + Arial',
                    'heading': {'primary': 'Microsoft YaHei', 'english': 'Arial', 'css': 'sans-serif'},
                    'body': {'primary': 'Microsoft YaHei', 'english': 'Arial', 'css': 'sans-serif'},
                    'body_size': 24,
                },
                'image_strategy': {
                    'name': 'Minimalist illustration',
                    'rendering': 'custom',
                    'visual': 'Crisp vector diagram with generous breathing room',
                    'mood': 'Objective and focused',
                    'behavior': 'Use minimalist-swiss composition aligned with the brand palette.',
                },
            })
        (self.project / 'confirm_ui' / 'recommendations.stage2.json').write_text(
            json.dumps({
                'stage': 'stage2',
                'selection_sha256': sel['selection_sha256'],
                'lang': 'zh',
                'recommend': {
                    'delivery_purpose': 'balanced',
                    'mode': 'custom',
                    'visual_style': 'custom',
                    'image_strategy': 'custom',
                    'image_usage': ['ai'],
                    'image_ai_path': 'auto',
                    'generation_mode': 'continuous',
                },
                'page_count': {'value': '12'},
                'image_notes': {'value': 'Hero visual on cover page.'},
                'proactive_speaker_notes': {'value': True},
                'proactive_custom_animations': {'value': False},
                'proactive_narration_audio': {'value': False},
                'refine_spec': {'value': False},
                'design_spec_depth': {'value': 'brief'},
                'design_directions': {'selected': 0, 'candidates': candidates},
            }, ensure_ascii=False),
            encoding='utf-8',
        )

        s2_get = self.client.get('/api/recommendations')
        self.assertEqual(s2_get.status_code, 200, s2_get.get_json())
        self.assertEqual(s2_get.get_json()['stage'], 'stage2')

        chosen = candidates[0]
        s2_confirm = self.client.post('/api/confirm', json={
            'stage': 'final',
            'primary_language': 'zh-CN',
            'canvas': 'ppt169',
            'delivery_purpose': 'balanced',
            'page_count': '12',
            'mode': chosen['mode'],
            'mode_behavior': chosen['mode_behavior'],
            'visual_style': chosen['visual_style'],
            'visual_style_behavior': chosen['visual_style_behavior'],
            'icons': chosen['icons'],
            'color': chosen['color'],
            'typography': {
                'name': chosen['typography']['name'],
                'heading': chosen['typography']['heading'],
                'body': chosen['typography']['body'],
                'body_size': 24,
                'body_size_unit': 'px',
                'sizes': {'title': 42, 'subtitle': 32, 'annotation': 18},
            },
            'image_usage': ['ai'],
            'image_notes': 'Hero visual on cover page.',
            'image_ai_path': 'auto',
            'image_strategy': chosen['image_strategy'],
            'generation_mode': 'continuous',
            'refine_spec': False,
            'design_spec_depth': 'brief',
            'proactive_speaker_notes': True,
            'proactive_custom_animations': False,
            'proactive_narration_audio': False,
        })
        self.assertEqual(s2_confirm.status_code, 200, s2_confirm.get_json())
        self.assertEqual(s2_confirm.get_json()['status'], 'ok')
        final_result = json.loads((self.project / 'confirm_ui' / 'result.json').read_text(encoding='utf-8'))
        self.assertEqual(final_result['stage'], 'final')
        self.assertEqual(final_result['status'], 'confirmed')

    def test_recommendations_expose_project_outline_preview(self) -> None:
        (self.project / 'outline.md').write_text(
            '# 滕王阁序深度导读\n\n'
            '## 01 · 封面：千古第一骈文的壮怀与画境\n'
            '- 落霞与孤鹜齐飞，秋水共长天一色\n\n'
            '## 02 · 章节：知人论世与重阳本事\n'
            '- 上元二年二十六岁南下省父\n',
            encoding='utf-8',
        )
        (self.project / 'confirm_ui' / 'recommendations.stage1.json').write_text(
            json.dumps({
                'stage': 'stage1',
                'lang': 'zh',
                'primary_language': 'zh-CN',
                'display_title': '《滕王阁序》深度导读',
                'template_options': {
                    'schema_version': 1,
                    'phase': 'template',
                    'lang': 'zh',
                    'default_mode': 'free_design',
                    'explicit_workspace_roots': [],
                },
                'core_message': {'value': '穷且益坚，不坠青云之志'},
                'communication_intent': {'value': '深度导读滕王阁序'},
                'audience': {'value': '古典文学爱好者'},
            }, ensure_ascii=False),
            encoding='utf-8',
        )
        resp = self.client.get('/api/recommendations')
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        preview = data.get('outline_preview') or {}
        self.assertIn('千古第一骈文', preview.get('cover_title', ''))
        self.assertIn('落霞与孤鹜齐飞', preview.get('cover_sub', ''))

    def test_recommendations_fallback_preview_without_outline(self) -> None:
        (self.project / 'confirm_ui' / 'recommendations.stage1.json').write_text(
            json.dumps({
                'stage': 'stage1',
                'lang': 'zh',
                'primary_language': 'zh-CN',
                'display_title': '盛唐骈文巅峰赏析',
                'template_options': {
                    'schema_version': 1,
                    'phase': 'template',
                    'lang': 'zh',
                    'default_mode': 'free_design',
                    'explicit_workspace_roots': [],
                },
                'core_message': {'value': '以落霞孤鹜与青云之志领略盛唐气象'},
                'communication_intent': {'value': '讲解滕王阁序的艺术成就与人生气象'},
                'audience': {'value': '高中与高校学习者'},
            }, ensure_ascii=False),
            encoding='utf-8',
        )
        resp = self.client.get('/api/recommendations')
        self.assertEqual(resp.status_code, 200)
        preview = (resp.get_json() or {}).get('outline_preview') or {}
        self.assertEqual(preview.get('cover_title'), '盛唐骈文巅峰赏析')
        self.assertIn('落霞孤鹜', preview.get('cover_sub', ''))


if __name__ == '__main__':
    unittest.main()
