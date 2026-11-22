#!/usr/bin/env python3
"""Render and cache the workbench's draft and delivered PowerPoint page images.

Usage: create one PreviewRenderer per workbench and poll its view from either
preview surface. A single background worker serializes desktop PowerPoint use.
"""

import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

def _draft_deck(source: Path, target: Path) -> None:
    from project_management.project_specs import parse_spec_lock
    from svg_to_pptx import create_pptx_with_native_svg
    from svg_to_pptx.drawingml.theme_colors import load_theme_color_spec
    from svg_to_pptx.drawingml.theme_fonts import load_master_text_style_spec, load_theme_font_spec
    from svg_to_pptx.pptx_package.template_structure import (
        load_native_structure_contract, load_pptx_structure_lock, load_template_source_themes,
    )

    project = source.parent.parent
    lock_path = project / 'spec_lock.md'
    lock = parse_spec_lock(lock_path) if lock_path.exists() else {}
    mode = lock.get('pptx_structure', {}).get('mode', 'flat')
    language = lock.get('communication', {}).get('primary_language')
    native_structure = load_native_structure_contract(load_pptx_structure_lock(project)) if mode == 'preserve' else None
    ok = create_pptx_with_native_svg(
        [source], target, resource_root=project, pptx_structure=mode, native_objects=True,
        primary_language=language, theme_font_spec=load_theme_font_spec(project, language),
        theme_color_spec=load_theme_color_spec(project), text_flow='preserve',
        master_text_style_spec=load_master_text_style_spec(project) if lock.get('typography') else None,
        source_theme_xml_by_master=load_template_source_themes(project / 'templates'),
        native_structure_contract=native_structure,
        transition=None, enable_notes=False, workers=1, verbose=False,
    )
    if not ok:
        raise ValueError('single-page PowerPoint compilation failed')


def _render(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        work = Path(tmp)
        deck = work / 'preview.pptx'
        if source.suffix.lower() == '.pptx':
            shutil.copyfile(source, deck)
        else:
            _draft_deck(source, deck)
        images = work / 'pages'
        images.mkdir()
        script = Path(__file__).with_name('render_powerpoint.ps1').read_text(encoding='utf-8')
        subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], check=True,
            env={**os.environ, 'PPT_PREVIEW_DECK': str(deck), 'PPT_PREVIEW_DIR': str(images)},
            capture_output=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        count = len(list(images.glob('*.png')))
        if not count:
            raise ValueError('PowerPoint returned no pages')
        for i in range(1, count + 1):
            png = images / f'{i}.png'
            with Image.open(png) as image:
                image.save(images / f'{i}.webp', quality=93, method=4)
                image.thumbnail((520, 520), Image.Resampling.LANCZOS)
                image.save(images / f'{i}-sm.webp', quality=90, method=4)
            png.unlink()
        (images / 'count').write_text(str(count), encoding='ascii')
        # Readers see either the previous version or an entire finished batch.
        if not destination.exists():
            images.rename(destination)


def _revision(path: Path) -> str:
    stat = path.stat()
    return f'{path.name}:{stat.st_mtime_ns}:{stat.st_size}'


def _cache_key(revision: str) -> str:
    return hashlib.sha256(('ppt-preview-v1:' + revision).encode()).hexdigest()


def _draft_resources(project: Path) -> str:
    paths = [project / 'spec_lock.md']
    for folder in ('images', 'icons', 'templates', 'data'):
        paths.extend((project / folder).rglob('*'))
    revisions = []
    for path in sorted(paths):
        try:
            if path.is_file():
                revisions.append(str(path.relative_to(project)) + _revision(path))
        except FileNotFoundError:
            continue
    return '|'.join(revisions)


class PreviewRenderer:
    def __init__(self, cache: Path):
        self.cache = cache
        self.worker = ThreadPoolExecutor(max_workers=1, thread_name_prefix='powerpoint-preview')
        self.lock = threading.Lock()
        self.active = set()
        self.failures = {}

    def _schedule(self, project: Path, source: Path, key: str) -> bool:
        destination = self.cache / project.name / key
        with self.lock:
            failed = self.failures.get(destination)
            if failed is not None and time.monotonic() - failed < 60:
                return False
            # Queue at most one job per project. On the next poll a newly
            # exported deck takes precedence over any still-unrendered drafts.
            if project not in self.active and not destination.is_dir():
                self.active.add(project)
                self.worker.submit(self._produce, project, source, destination)
        return True

    def _produce(self, project: Path, source: Path, destination: Path) -> None:
        try:
            _render(source, destination)
        except Exception:
            logging.getLogger('workbench').exception('PowerPoint preview failed for %s', source)
            with self.lock:
                self.failures[destination] = time.monotonic()
        finally:
            with self.lock:
                self.active.discard(project)

    def view(self, project: Path, slides: list, exports: list) -> dict:
        pages = [{'name': slide['name'], 'number': int(re.match(r'P?(\d+)', slide['name'])[1]), 'image': None}
                 for slide in slides]
        view = {'pages': pages, 'source': 'draft', 'message': ''}
        if not slides and not exports:
            return view
        if os.name != 'nt':
            view['message'] = '此预览需要 Windows 桌面版 PowerPoint。'
            return view
        cache = self.cache / project.name
        latest_slide = max((int(slide['version']) for slide in slides), default=0)
        revisions = []
        for item in exports:
            path = project / 'exports' / item['name']
            try:
                if path.is_file() and path.resolve().parent == project / 'exports':
                    stat = path.stat()
                    revisions.append((stat.st_mtime_ns, path, stat.st_size))
            except FileNotFoundError:
                continue
        modified, deck, size = max(revisions, default=(0, None, 0))
        final = deck is not None and modified >= latest_slide
        if final:
            key = _cache_key(f'{deck.name}:{modified}:{size}')
            count_file = cache / key / 'count'
            if count_file.is_file():
                count = int(count_file.read_text(encoding='ascii'))
                view['source'] = 'final'
                names = {p['number']: p['name'] for p in pages}
                view['pages'] = [
                    {'name': pages[i]['name'] if count == len(pages) else names.get(i + 1, f'P{i + 1:02}'),
                     'number': i + 1, 'image': f'{key}/{i + 1}.webp'} for i in range(count)]
                return view
            view['message'] = ('正在从最终 PPTX 更新预览…' if self._schedule(project, deck, key)
                               else '最终预览暂时无法生成，请确认本机可打开 PowerPoint。稍后会自动重试。')
        resources = _draft_resources(project) if pages else ''
        for page, slide in zip(pages, slides):
            path = project / 'svg_output' / slide['name']
            key = _cache_key(f"{path.name}:{slide['version']}:{slide['size']}:{resources}")
            if (cache / key / '1.webp').is_file():
                page['image'] = f'{key}/1.webp'
            elif not final and path.resolve().parent == project / 'svg_output':
                if not self._schedule(project, path, key):
                    page['error'] = 'PowerPoint 暂时无法生成此页预览，稍后会自动重试。'
        return view
