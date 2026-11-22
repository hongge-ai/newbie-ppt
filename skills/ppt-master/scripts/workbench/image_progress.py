#!/usr/bin/env python3
"""Newbie PPT - Project image counts and previews for the workbench progress API."""

import json
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

from PIL import Image

from project_management.project_specs import parse_spec_lock, parse_spec_lock_image_value


@lru_cache(maxsize=512)
def _readable_image(path: Path, mtime_ns: int, size: int) -> bool:
    """Decode each revision once so partially written files stay out of the gallery."""
    try:
        if path.suffix.lower() == '.svg':
            return ET.parse(path).getroot().tag in ('svg', '{http://www.w3.org/2000/svg}svg')
        with Image.open(path) as image:
            image.load()
        return True
    except (OSError, ValueError, SyntaxError, ET.ParseError, Image.DecompressionBombError):
        return False


def project_image_progress(project: Path) -> dict:
    directory = project / 'images'
    planned = {}
    known = False
    try:
        sections = parse_spec_lock(project / 'spec_lock.md')
        known = 'images' in sections
        for key, value in sections.get('images', {}).items():
            try:
                row = parse_spec_lock_image_value(key, value)
            except ValueError:
                continue
            if row['source'] not in ('placeholder', 'formula'):
                name = row['path'].replace('\\', '/').removeprefix('images/')
                planned[name] = {}
    except (OSError, ValueError):
        pass

    try:
        manifest = json.loads((directory / 'image_prompts.json').read_text(encoding='utf-8-sig'))
        items = manifest.get('items') if isinstance(manifest, dict) else None
        if isinstance(items, list):
            known = True
            for item in items:
                if isinstance(item, dict) and isinstance(item.get('filename'), str):
                    planned[item['filename']] = item
    except (OSError, ValueError):
        pass

    ready = []
    total = failed = manual = 0
    for name, item in planned.items():
        if (not name or any(part in ('', '.', '..') for part in name.split('/'))
                or any(char in name for char in (':', '\\', '\x00'))
                or Path(name).suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg')):
            continue
        path = directory / name
        total += 1
        if item.get('status') == 'Failed':
            failed += 1
            continue
        try:
            if path.resolve().is_relative_to(directory.resolve()) and path.is_file():
                stat = path.stat()
                if stat.st_size and _readable_image(path, stat.st_mtime_ns, stat.st_size):
                    ready.append({'name': name, 'label': item.get('alt_text') or item.get('purpose') or name,
                                  'version': str(stat.st_mtime_ns)})
                    continue
        except (OSError, RuntimeError):
            pass
        if item.get('status') == 'Needs-Manual':
            manual += 1
    return {'total': total if known else None, 'ready': ready, 'failed': failed, 'manual': manual}
