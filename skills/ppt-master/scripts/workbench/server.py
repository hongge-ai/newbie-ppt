#!/usr/bin/env python3
"""
Newbie PPT - Workbench UI Server

Repository-level local web workbench for PPT generation tasks. Unlike the
per-project Confirm UI, one instance serves the whole repository: users
create tasks, browse and preview the registered template library, configure
generation parameters, and watch progress, while the executing AI agent
consumes the submitted task files and writes status back. The server never
runs generation itself and never calls any model; all agent communication
happens through task files under ``projects/.workbench/tasks/``.

See scripts/docs/workbench.md for the file-bus contract, task schema, and
HTTP API reference.

Usage:
    python3 scripts/workbench/server.py

Examples:
    python3 scripts/workbench/server.py
    python3 scripts/workbench/server.py --port 7071
    python3 scripts/workbench/server.py --no-browser
    python3 scripts/workbench/server.py --daemon
    python3 scripts/workbench/server.py --shutdown

Dependencies:
    flask>=3.0.0
"""

import argparse
import atexit
import hashlib
import json
import logging
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, request, send_from_directory

# Local — sys.path injection for sibling module (code-style.md §3)
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from config import CANVAS_FORMATS  # noqa: E402
from console_encoding import configure_utf8_stdio  # noqa: E402
from server_common import (  # noqa: E402
    claim_lock as _claim_lock,
    clear_lock as _clear_lock,
    find_free_port as _find_free_port,
    lock_pid as _lock_pid,
    open_preview_browser,
    plain_request_log,
    popen_detached as _popen_detached,
    process_alive as _process_alive,
    read_lock as _read_lock,
    release_lock as _release_lock,
    validate_port as _validate_port,
)

configure_utf8_stdio()

logger = logging.getLogger('workbench')

# Repository-level runtime root, kept under projects/ so the existing
# "projects/*" .gitignore entry covers it without any repo change. The dotted
# directory name keeps project scanners (which skip dot directories and match
# on project markers) from ever treating it as a project tree.
WORKBENCH_DIR_NAME = '.workbench'
TASKS_DIR_NAME = 'tasks'
TASK_FILE_NAME = 'task.json'
FEEDBACK_FILE_NAME = 'feedback.json'
UPLOADS_DIR_NAME = 'uploads'
TASK_SCHEMA_VERSION = 2
LOCK_FILE_NAME = 'workbench.lock'
SERVER_LOG_NAME = 'server.log'

# Task registry shape. Task ids are pure ASCII (generated); user text lives
# only inside task.json values so Chinese titles never become path segments.
TASK_ID_RE = re.compile(r't\d{8}-\d{6}-[0-9a-f]{4}\Z')
# Saved custom templates ("我的模板") follow the same generated-id discipline:
# one JSON file per record under .workbench/custom_templates/, name is data.
CUSTOM_TEMPLATES_DIR_NAME = 'custom_templates'
CUSTOM_TEMPLATE_ID_RE = re.compile(r'ct\d{8}-\d{6}-[0-9a-f]{4}\Z')
CUSTOM_TEMPLATE_SCHEMA_VERSION = 1
CUSTOM_TEMPLATE_NAME_MAX = 40
IMAGE_POLICY_VALUES = {'auto', 'none', 'web', 'ai'}
PAGE_COUNT_MIN = 1
PAGE_COUNT_MAX = 60
TEMPLATE_KINDS = ('brand', 'style', 'layout', 'deck')
_TEMPLATE_LIBRARY_CONFIG = {
    'brand': ('brands', 'brands_index.json'),
    'style': ('styles', 'styles_index.json'),
    'layout': ('layouts', 'layouts_index.json'),
    'deck': ('decks', 'decks_index.json'),
}
_SAFE_TEMPLATE_ID_RE = re.compile(r'\w[\w.-]*\Z')
AGENT_HINT_TEMPLATE = (
    '请处理工作台任务 {task_id}:读取 projects/.workbench/tasks/{task_id}/task.json '
    '并按其中的用户域参数生成 PPT。'
)

# Slide file names inside a generated project's svg_output/: a numeric
# segment (with optional P prefix) followed by anything, e.g. P01.svg,
# 01_cover.svg. Mirrors the roster ordering contract's naming half.
_SLIDE_NAME_RE = re.compile(r'(?:P)?\d{1,3}[\w.-]*\.svg\Z')
_EXPORT_NAME_RE = re.compile(r'[\w.-]+\.pptx\Z')

# Dedicated port range so stale workbench tabs can never address a later
# Confirm UI (5050) or live preview (6060) process.
DEFAULT_PORT = 7070
PUBLIC_HOST = '127.0.0.1'
# The workbench is a long-lived cockpit: users walk away mid-journey and come
# back, so idle auto-shutdown is disabled by default (pass --timeout to arm).
DEFAULT_IDLE_TIMEOUT = 0
STARTUP_TIMEOUT = 10
MAX_UPLOAD_BYTES = 200 * 1024 * 1024

_SKILL_DIR = Path(__file__).resolve().parents[2]
# Same derivation as project_management.paths.REPO_ROOT: the skill root's
# grandparent is the repository root. A standalone skill install without a
# repository checkout simply gets <install-parent>/projects as its root.
DEFAULT_PROJECTS_ROOT = _SKILL_DIR.parent.parent / 'projects'
_OPTIONS_PATH = Path(__file__).resolve().parent / 'static' / 'options.json'


def _repo_root(projects_root: Path) -> Path:
    """Return the repository root that owns a projects root."""
    return projects_root.parent


def _workbench_dir(projects_root: Path) -> Path:
    """Return the workbench runtime directory for a projects root."""
    return projects_root / WORKBENCH_DIR_NAME


def _tasks_dir(projects_root: Path) -> Path:
    """Return the task registry directory for a projects root."""
    return _workbench_dir(projects_root) / TASKS_DIR_NAME


def _custom_templates_dir(projects_root: Path) -> Path:
    """Return the saved custom-template directory for a projects root."""
    return _workbench_dir(projects_root) / CUSTOM_TEMPLATES_DIR_NAME


def _read_json_object(path: Path, retries: int = 2, delay: float = 0.08) -> dict:
    """Read a JSON object, retrying briefly around non-atomic external writes."""
    last_error: Exception = ValueError('unknown JSON read error')
    for attempt in range(retries + 1):
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'))
            if isinstance(data, dict):
                return data
            raise ValueError(f'{path} top-level JSON value must be an object')
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(delay)
                continue
            raise last_error
    raise last_error


def _write_json_atomic(path: Path, data: dict) -> None:
    """Write a JSON object with replace semantics so readers never see a partial file.

    On Windows, os.replace fails with access-denied while real-time antivirus
    briefly holds the target after a recent write; retry the replace briefly
    instead of surfacing a 500 to the browser or agent.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding='utf-8',
        )
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.06)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _count_tasks(tasks_dir: Path) -> int:
    """Count task records on disk; unreadable states report zero."""
    if not tasks_dir.is_dir():
        return 0
    count = 0
    try:
        for entry in tasks_dir.iterdir():
            if (entry / TASK_FILE_NAME).is_file():
                count += 1
    except OSError:
        return 0
    return count


def _now_iso() -> str:
    """Return the local timestamp format used across task.json fields."""
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def _new_task_id() -> str:
    """Generate a fresh ASCII task id (date-time plus short random suffix)."""
    return f't{datetime.now().strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(2)}'


def _new_custom_template_id() -> str:
    """Generate a fresh ASCII custom-template id."""
    return f'ct{datetime.now().strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(2)}'


def _task_dir_path(projects_root: Path, task_id: str) -> Path:
    """Return one task's directory; callers validate the id shape first."""
    return _tasks_dir(projects_root) / task_id


def _task_file_path(projects_root: Path, task_id: str) -> Path:
    """Return one task's task.json path."""
    return _task_dir_path(projects_root, task_id) / TASK_FILE_NAME


def _templates_dir() -> Path:
    """Return the bundled template library root."""
    return _SKILL_DIR / 'templates'


def _template_index_path(kind: str) -> Path:
    """Return the index file path for one registered template kind."""
    kind_dir, index_name = _TEMPLATE_LIBRARY_CONFIG[kind]
    return _templates_dir() / kind_dir / index_name


def _load_template_index(kind: str) -> dict:
    """Read one template kind index (the only enumeration source)."""
    return _read_json_object(_template_index_path(kind), retries=0)


def _indexes_sha256() -> dict:
    """Fingerprint the four template indexes for staleness detection."""
    digests = {}
    for kind in TEMPLATE_KINDS:
        try:
            raw = _template_index_path(kind).read_bytes()
        except OSError:
            digests[kind] = None
            continue
        digests[kind] = hashlib.sha256(raw).hexdigest()
    return digests


def _safe_template_id(template_id: object) -> bool:
    """Return whether an index key is one safe directory-segment id."""
    return (
        isinstance(template_id, str)
        and _SAFE_TEMPLATE_ID_RE.fullmatch(template_id) is not None
    )


def _custom_template_file_path(projects_root: Path, ct_id: str) -> Path:
    """Return one custom template's JSON path; callers validate the id first."""
    return _custom_templates_dir(projects_root) / f'{ct_id}.json'


def _custom_template_selection_pairs(record: dict) -> list[dict]:
    """Return the stored (kind, id) pairs of a custom-template record."""
    return [
        {'kind': item.get('kind'), 'id': item.get('id')}
        for item in record.get('selections', [])
        if isinstance(item, dict)
    ]


def _custom_template_invalid(record: dict) -> list[str]:
    """List selections whose id is no longer a key in its kind's index."""
    invalid = []
    for item in _custom_template_selection_pairs(record):
        kind = item.get('kind')
        template_id = item.get('id')
        if (
            kind not in TEMPLATE_KINDS
            or not _safe_template_id(template_id)
            or _template_index_entry(kind, template_id) is None
        ):
            invalid.append(f'{kind}/{template_id}')
    return invalid


def _custom_template_summary(record: dict) -> str:
    """One-line combination summary for market cards."""
    return ' + '.join(
        f'{item["kind"]}/{item["id"]}'
        for item in _custom_template_selection_pairs(record)
    )


def _custom_template_payload(record: dict) -> dict:
    """API card for one saved custom template."""
    return {
        'id': record.get('id'),
        'name': record.get('name'),
        'summary': _custom_template_summary(record),
        'selections': _custom_template_selection_pairs(record),
        'invalid': _custom_template_invalid(record),
        'created_at': record.get('created_at'),
        'updated_at': record.get('updated_at'),
    }


def _load_custom_templates(projects_root: Path) -> list[dict]:
    """Read every saved custom-template record, newest update first.

    Unreadable or malformed files are skipped: the registry must keep serving
    even when one record was damaged externally.
    """
    directory = _custom_templates_dir(projects_root)
    records = []
    if not directory.is_dir():
        return records
    try:
        entries = sorted(directory.iterdir())
    except OSError:
        return records
    for entry in entries:
        if entry.suffix != '.json':
            continue
        if CUSTOM_TEMPLATE_ID_RE.fullmatch(entry.stem) is None:
            continue
        try:
            record = _read_json_object(entry, retries=0)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        record.setdefault('id', entry.stem)
        records.append(record)
    records.sort(key=lambda item: str(item.get('updated_at') or ''), reverse=True)
    return records


def _find_custom_template_by_name(records: list[dict], name: str) -> Optional[dict]:
    """Return the record using exactly this name, if any."""
    for record in records:
        if record.get('name') == name:
            return record
    return None


def _validate_custom_template_fields(
    records: list[dict],
    name: object,
    selections: object,
    exclude_id: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[list], Optional[dict]]:
    """Validate name + selections for create/update.

    Returns (name, error, resolved_selections, name_clash). ``name_clash`` is
    the colliding record when the name is already taken by another record.
    """
    if not isinstance(name, str):
        return None, 'name must be a string', None, None
    name = name.strip()
    if not name:
        return None, 'name must be non-empty', None, None
    if len(name) > CUSTOM_TEMPLATE_NAME_MAX:
        return None, f'name must be at most {CUSTOM_TEMPLATE_NAME_MAX} characters', None, None
    clash = _find_custom_template_by_name(records, name)
    if clash is not None and clash.get('id') != exclude_id:
        return name, None, None, clash
    if selections is None:
        return name, None, None, None
    resolved, error = _resolve_library_selections(selections)
    if error:
        return name, error, None, None
    if not resolved:
        return name, 'at least one selection is required', None, None
    return name, None, resolved, None


def _default_task(task_id: str, topic: str, display_title: Optional[str]) -> dict:
    """Build a fresh draft task record with the default user choices."""
    now = _now_iso()
    return {
        'schema_version': TASK_SCHEMA_VERSION,
        'task_id': task_id,
        'status': 'draft',
        'created_at': now,
        'submitted_at': None,
        'updated_at': now,
        'display_title': display_title,
        'topic': topic,
        'requirements': {'audience': '', 'tone': '', 'extra': ''},
        'params': {
            'canvas': 'ppt169',
            'page_count': None,
            'primary_language': 'zh-CN',
            'speaker_notes': False,
            'image_policy': 'auto',
        },
        'template_selection': {
            'mode': 'free_design',
            'selections': [],
            'indexes_sha256': _indexes_sha256(),
            'selected_at': now,
        },
        'uploads': [],
        'project_dir': None,
        'started_at': None,
        'finished_at': None,
        'error': None,
        'deliverables': [],
        'agent_log': [],
    }


def _apply_params_patch(params: dict, patch: object) -> Optional[str]:
    """Merge accepted params fields; return an error message or None."""
    if not isinstance(patch, dict):
        return 'params must be a JSON object'
    if 'canvas' in patch:
        canvas = patch['canvas']
        if canvas is not None and canvas not in CANVAS_FORMATS:
            return f'unknown canvas: {canvas}'
    if 'page_count' in patch:
        count = patch['page_count']
        if count is not None:
            if isinstance(count, bool) or not isinstance(count, int):
                return 'page_count must be an integer or null'
            if not PAGE_COUNT_MIN <= count <= PAGE_COUNT_MAX:
                return f'page_count must be {PAGE_COUNT_MIN}..{PAGE_COUNT_MAX}'
    if 'primary_language' in patch:
        language = patch['primary_language']
        if not isinstance(language, str) or not language.strip():
            return 'primary_language must be a non-empty string'
    if 'speaker_notes' in patch and not isinstance(patch['speaker_notes'], bool):
        return 'speaker_notes must be a boolean'
    if 'image_policy' in patch and patch['image_policy'] not in IMAGE_POLICY_VALUES:
        return f'image_policy must be one of {sorted(IMAGE_POLICY_VALUES)}'
    for key in ('canvas', 'page_count', 'primary_language',
                'speaker_notes', 'image_policy'):
        if key in patch:
            params[key] = patch[key]
    return None


def _resolve_library_selections(raw_selections: object) -> tuple[Optional[list], Optional[str]]:
    """Resolve (kind, id) pairs against the library indexes.

    Selections are accepted as (kind, id) pairs only; each workspace_root is
    resolved server-side from the registered indexes so a browser can never
    submit an arbitrary path. Shared by task selection updates and custom-
    template saves. Returns (resolved_entries, error_message).
    """
    if not isinstance(raw_selections, list):
        return None, 'selections must be a list'
    resolved = []
    kinds_seen = set()
    for item in raw_selections:
        if not isinstance(item, dict):
            return None, 'each selection must be a JSON object'
        kind = item.get('kind')
        template_id = item.get('id')
        if kind not in TEMPLATE_KINDS:
            return None, f'unknown template kind: {kind}'
        if not _safe_template_id(template_id):
            return None, f'invalid template id: {template_id!r}'
        if kind in kinds_seen:
            return None, f'at most one {kind} selection is allowed'
        try:
            index = _load_template_index(kind)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            return None, f'cannot read {kind} index: {exc}'
        if template_id not in index:
            return None, f'unknown {kind} template id: {template_id}'
        kind_dir, _index_name = _TEMPLATE_LIBRARY_CONFIG[kind]
        resolved.append({
            'source': 'library',
            'kind': kind,
            'id': template_id,
            'workspace_root': str(_templates_dir() / kind_dir / template_id),
        })
        kinds_seen.add(kind)
    return resolved, None


def _apply_template_selection(task: dict, selection: object) -> Optional[str]:
    """Validate and store one template selection update."""
    if not isinstance(selection, dict):
        return 'template_selection must be a JSON object'
    mode = selection.get('mode')
    if mode not in ('free_design', 'templates'):
        return 'template_selection.mode must be free_design or templates'
    resolved, error = _resolve_library_selections(selection.get('selections', []))
    if error:
        return f'template_selection.{error}'
    if mode == 'templates' and not resolved:
        return 'templates mode requires at least one selection'
    if mode == 'free_design' and resolved:
        return 'free_design mode must have no selections'
    task['template_selection'] = {
        'mode': mode,
        'selections': resolved,
        'indexes_sha256': _indexes_sha256(),
        'selected_at': _now_iso(),
    }
    return None


def _apply_user_patch(task: dict, payload: object) -> Optional[str]:
    """Merge draft-editable user fields; return an error message or None."""
    if not isinstance(payload, dict):
        return 'payload must be a JSON object'
    if 'display_title' in payload:
        title = payload['display_title']
        if title is not None and not isinstance(title, str):
            return 'display_title must be a string or null'
        if isinstance(title, str) and len(title) > 200:
            return 'display_title must be at most 200 characters'
        task['display_title'] = title.strip() if isinstance(title, str) else None
    if 'topic' in payload:
        topic = payload['topic']
        if not isinstance(topic, str) or not topic.strip():
            return 'topic must be a non-empty string'
        task['topic'] = topic.strip()
    if 'requirements' in payload:
        requirements = payload['requirements']
        if not isinstance(requirements, dict):
            return 'requirements must be a JSON object'
        for key in ('audience', 'tone', 'extra'):
            if key in requirements:
                value = requirements[key]
                if value is not None and not isinstance(value, str):
                    return f'requirements.{key} must be a string'
                task['requirements'][key] = (value or '').strip()
    if 'params' in payload:
        error = _apply_params_patch(task['params'], payload['params'])
        if error:
            return error
    if 'template_selection' in payload:
        error = _apply_template_selection(task, payload['template_selection'])
        if error:
            return error
    return None


def _submit_error(task: dict) -> Optional[str]:
    """Return the blocking error for a draft submission, or None."""
    if not str(task.get('topic') or '').strip():
        return 'topic is required before submitting'
    selection = task.get('template_selection') or {}
    mode = selection.get('mode')
    if mode not in ('free_design', 'templates'):
        return 'template_selection.mode is invalid'
    if mode == 'templates' and not selection.get('selections'):
        return 'templates mode requires at least one selection'
    return None


def _sanitize_upload_name(name: object) -> Optional[str]:
    """Reduce one client filename to a safe single path segment.

    Keeps CJK characters (source material is routinely named in Chinese);
    drops both separators, Windows-reserved characters, and control bytes.
    """
    if not isinstance(name, str):
        return None
    base = name.replace('\\', '/').split('/')[-1]
    cleaned = ''.join(
        ch for ch in base
        if ord(ch) >= 32 and ch not in '<>:"|?*'
    ).strip().rstrip('.')
    return cleaned or None


def _unique_upload_path(directory: Path, name: str) -> Path:
    """Return a non-clashing upload target, appending _2, _3, ... suffixes."""
    candidate = directory / name
    if not candidate.exists():
        return candidate
    stem, dot, suffix = name.rpartition('.')
    if not dot:
        stem, suffix = name, ''
    index = 2
    while True:
        candidate = directory / (f'{stem}_{index}.{suffix}' if suffix else f'{stem}_{index}')
        if not candidate.exists():
            return candidate
        index += 1


def _uploads_listing(task_dir: Path) -> list:
    """List the material files currently staged in one task's uploads/."""
    uploads_dir = task_dir / UPLOADS_DIR_NAME
    listed = []
    if not uploads_dir.is_dir():
        return listed
    try:
        entries = sorted(uploads_dir.iterdir(), key=lambda p: p.name)
    except OSError:
        return listed
    for path in entries:
        if not path.is_file():
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        listed.append({'name': path.name, 'size': size})
    return listed


def _list_task_summaries(projects_root: Path) -> list:
    """Summarize every task record, newest first, skipping junk entries."""
    registry = _tasks_dir(projects_root)
    summaries = []
    if not registry.is_dir():
        return summaries
    try:
        entries = list(registry.iterdir())
    except OSError:
        return summaries
    for entry in entries:
        if not entry.is_dir() or TASK_ID_RE.fullmatch(entry.name) is None:
            continue
        if not (entry / TASK_FILE_NAME).is_file():
            continue
        try:
            data = _read_json_object(entry / TASK_FILE_NAME, retries=0)
        except (OSError, json.JSONDecodeError, ValueError):
            summaries.append({
                'task_id': entry.name,
                'display_title': None,
                'status': 'error',
                'created_at': None,
                'submitted_at': None,
                'updated_at': None,
                'project_dir': None,
                'error': 'invalid task.json',
            })
            continue
        summaries.append({
            'task_id': data.get('task_id') or entry.name,
            'display_title': data.get('display_title'),
            'status': data.get('status'),
            'created_at': data.get('created_at'),
            'submitted_at': data.get('submitted_at'),
            'updated_at': data.get('updated_at'),
            'project_dir': data.get('project_dir'),
            'error': data.get('error'),
        })
    summaries.sort(key=lambda item: item.get('created_at') or '', reverse=True)
    return summaries


# Template market catalog cache, keyed on the four index file mtimes.
_TEMPLATE_MARKET_CACHE = {'mtimes': None, 'catalog': None}
_TEMPLATE_MARKET_LOCK = threading.Lock()


def _index_mtimes() -> tuple:
    """Fingerprint the four template index files by mtime."""
    stamps = []
    for kind in TEMPLATE_KINDS:
        path = _template_index_path(kind)
        try:
            stamps.append(path.stat().st_mtime_ns)
        except OSError:
            stamps.append(0)
    return tuple(stamps)


def _template_market() -> dict:
    """Build the four-kind template catalog from the library indexes.

    Indexes are the only enumeration source; directory scanning is never used
    for discovery. Entries whose index key is not a safe id are skipped.
    """
    with _TEMPLATE_MARKET_LOCK:
        mtimes = _index_mtimes()
        if _TEMPLATE_MARKET_CACHE['catalog'] is not None and _TEMPLATE_MARKET_CACHE['mtimes'] == mtimes:
            return _TEMPLATE_MARKET_CACHE['catalog']
        catalog = {}
        for kind in TEMPLATE_KINDS:
            kind_dir, _index_name = _TEMPLATE_LIBRARY_CONFIG[kind]
            try:
                index = _load_template_index(kind)
            except (OSError, json.JSONDecodeError, ValueError):
                catalog[kind] = []
                continue
            entries = []
            for template_id, meta in index.items():
                if not _safe_template_id(template_id) or not isinstance(meta, dict):
                    continue
                card = {
                    'kind': kind,
                    'id': template_id,
                    'summary': meta.get('summary'),
                    'workspace_root': str(_templates_dir() / kind_dir / template_id),
                }
                for field in ('primary_color', 'keywords', 'canvas_format', 'page_count', 'page_types'):
                    if field in meta:
                        card[field] = meta[field]
                entries.append(card)
            entries.sort(key=lambda card: card['id'])
            catalog[kind] = entries
        _TEMPLATE_MARKET_CACHE['mtimes'] = mtimes
        _TEMPLATE_MARKET_CACHE['catalog'] = catalog
        return catalog


def _template_index_entry(kind: str, template_id: str) -> Optional[dict]:
    """Return one validated index entry for a whitelisted template file route."""
    if kind not in _TEMPLATE_LIBRARY_CONFIG:
        return None
    if not _safe_template_id(template_id):
        return None
    try:
        index = _load_template_index(kind)
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    meta = index.get(template_id)
    return meta if isinstance(meta, dict) else None


def _template_workspace_root(kind: str, template_id: str) -> Path:
    """Return the workspace root for one registered template."""
    kind_dir, _index_name = _TEMPLATE_LIBRARY_CONFIG[kind]
    return _templates_dir() / kind_dir / template_id


_FRONTMATTER_LINE_RE = re.compile(r'^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$')


def _parse_design_spec_frontmatter(kind: str, template_id: str) -> dict:
    """Extract the key/value frontmatter of one template's design_spec.md."""
    spec_path = _template_workspace_root(kind, template_id) / 'templates' / 'design_spec.md'
    try:
        lines = spec_path.read_text(encoding='utf-8-sig').splitlines()
    except OSError:
        return {}
    if not lines or lines[0].strip() != '---':
        return {}
    frontmatter = {}
    for line in lines[1:]:
        if line.strip() == '---':
            break
        match = _FRONTMATTER_LINE_RE.match(line)
        if match and match.group(1) not in frontmatter:
            value = match.group(2).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            frontmatter[match.group(1)] = value
    return frontmatter


def _template_preview_payload(kind: str, template_id: str) -> Optional[dict]:
    """Build the preview payload: roster SVG urls or an identity card."""
    meta = _template_index_entry(kind, template_id)
    if meta is None:
        return None
    payload = {
        'kind': kind,
        'id': template_id,
        'summary': meta.get('summary'),
        'frontmatter': _parse_design_spec_frontmatter(kind, template_id),
    }
    for field in ('primary_color', 'keywords', 'canvas_format', 'page_count', 'page_types'):
        if field in meta:
            payload[field] = meta[field]
    roster = []
    templates_dir = _template_workspace_root(kind, template_id) / 'templates'
    if templates_dir.is_dir():
        base = f'/templates/{urllib.parse.quote(kind, safe="")}/{urllib.parse.quote(template_id, safe="")}/templates'
        try:
            svg_files = sorted(templates_dir.glob('*.svg'))
        except OSError:
            svg_files = []
        for svg_file in svg_files:
            roster.append({
                'name': svg_file.name,
                'svg_url': f'{base}/{urllib.parse.quote(svg_file.name, safe="")}',
            })
    payload['roster'] = roster
    payload['images_url_prefix'] = (
        f'/templates/{urllib.parse.quote(kind, safe="")}/{urllib.parse.quote(template_id, safe="")}'
    )
    return payload


def _file_listing(directory: Path, name_pattern: re.Pattern) -> list:
    """List one directory's files whose names match a whitelist pattern."""
    listed = []
    if not directory.is_dir():
        return listed
    try:
        entries = list(directory.iterdir())
    except OSError:
        return listed
    for path in entries:
        if not path.is_file() or name_pattern.fullmatch(path.name) is None:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        listed.append({'name': path.name, 'size': stat.st_size, 'mtime': int(stat.st_mtime)})
    listed.sort(key=lambda item: item['name'])
    return listed


def _slide_sort_key(name: str):
    """Order slide names by their leading numeric segment."""
    digits = re.match(r'(?:P)?(\d+)', name)
    return (int(digits.group(1)) if digits else 0, name)


def _task_progress_payload(task: dict, task_dir: Path) -> dict:
    """Derive the read-only progress view from the project tree."""
    payload = {
        'task_id': task.get('task_id'),
        'status': task.get('status'),
        'error': task.get('error'),
        'project_dir': task.get('project_dir'),
        'slides': [],
        'slide_count': 0,
        'quality': {'report_exists': False},
        'exports': [],
        'confirm': None,
        'agent_log': task.get('agent_log') or [],
        'deliverables': task.get('deliverables') or [],
        'finished_at': task.get('finished_at'),
    }
    project_dir = task.get('project_dir')
    if not project_dir:
        return payload
    project_path = Path(project_dir)
    slides = _file_listing(project_path / 'svg_output', _SLIDE_NAME_RE)
    slides.sort(key=lambda item: _slide_sort_key(item['name']))
    payload['slides'] = slides
    payload['slide_count'] = len(slides)

    quality_file = project_path / 'validation' / 'svg_quality_report.json'
    try:
        quality_stat = quality_file.stat()
        payload['quality'] = {
            'report_exists': True,
            'mtime': int(quality_stat.st_mtime),
        }
    except OSError:
        payload['quality'] = {'report_exists': False}

    payload['exports'] = sorted(
        _file_listing(project_path / 'exports', _EXPORT_NAME_RE),
        key=lambda item: item['mtime'],
        reverse=True,
    )

    session_file = project_path / 'confirm_ui' / 'session.json'
    try:
        session = _read_json_object(session_file, retries=0)
        payload['confirm'] = {
            'status': session.get('status'),
            'current_stage': session.get('current_stage'),
        }
    except (OSError, json.JSONDecodeError, ValueError):
        payload['confirm'] = None
    return payload


def _read_feedback(task_dir: Path) -> Optional[dict]:
    """Read one task's feedback.json if present and valid."""
    path = task_dir / FEEDBACK_FILE_NAME
    if not path.is_file():
        return None
    try:
        return _read_json_object(path, retries=0)
    except (OSError, json.JSONDecodeError, ValueError):
        return None


def _server_url(port: int, path: str = '') -> str:
    """Return the loopback URL shown to users and used by readiness probes."""
    suffix = path if path.startswith('/') or not path else f'/{path}'
    return f'http://{PUBLIC_HOST}:{port}{suffix}'


def _wait_for_server_ready(
    port: int,
    proc: subprocess.Popen,
    projects_root: Path,
    timeout: int = STARTUP_TIMEOUT,
) -> int:
    """Wait until this repository's detached workbench server accepts requests.

    Returns the server pid recorded in the workbench lock, or 0 on timeout.
    ``proc.pid`` is not used for identity: on Windows a venv ``python.exe``
    may be a launcher whose child is the real interpreter.
    """
    deadline = time.time() + timeout
    last_error = ''
    health_url = _server_url(port, '/api/health')
    lock_file = _workbench_dir(projects_root) / LOCK_FILE_NAME
    while time.time() < deadline:
        returncode = proc.poll()
        if returncode is not None:
            logger.error('workbench server exited during startup (code=%s)', returncode)
            return 0
        try:
            with urllib.request.urlopen(health_url, timeout=1) as resp:
                data = json.load(resp)
                lock = _read_lock(lock_file)
                server_pid = _lock_pid(lock)
                if (
                    resp.status == 200
                    and isinstance(data, dict)
                    and data.get('service') == 'workbench'
                    and data.get('repo_root') == str(_repo_root(projects_root))
                    and lock is not None
                    and lock.get('port') == port
                    and data.get('pid') == server_pid
                ):
                    return server_pid
                last_error = 'health response belongs to another service or repository'
        except (OSError, ValueError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(0.2)
    logger.error(
        'workbench server did not become ready at %s within %ss%s',
        health_url,
        timeout,
        f' (last error: {last_error})' if last_error else '',
    )
    return 0


def _launch_background_server(
    projects_root: Path,
    *,
    preferred_port: int,
    exact_port: bool,
    idle_timeout: int,
    open_browser: bool,
) -> tuple[subprocess.Popen, int, Path]:
    """Start the workbench server child and wait until it is reachable."""
    runtime_dir = _workbench_dir(projects_root)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    log_path = runtime_dir / SERVER_LOG_NAME
    port = preferred_port if exact_port else _find_free_port(preferred_port)
    cmd = [
        sys.executable,
        str(Path(__file__).resolve()),
        '--port',
        str(port),
        '--timeout',
        str(idle_timeout),
        '--no-browser',
    ]
    with log_path.open('a', encoding='utf-8') as log:
        proc = _popen_detached(
            cmd,
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            logger=logger,
        )
    logger.info('log: %s', log_path)
    server_pid = _wait_for_server_ready(port, proc, projects_root)
    if not server_pid:
        if proc.poll() is None:
            proc.terminate()
        raise RuntimeError(f'workbench server failed to become reachable: {_server_url(port)}')
    url = _server_url(port)
    logger.info('started workbench in background: %s (pid=%s)', url, server_pid)
    if open_browser:
        open_preview_browser(url, logger=logger)
    return proc, port, log_path


def _shutdown_existing(lock_file: Path) -> int:
    """Stop a workbench server left running (idempotent).

    Tries a graceful ``/api/shutdown`` first, falls back to killing the
    recorded pid, then clears the lock. A no-op when nothing is running.
    """
    existing = _read_lock(lock_file)
    if not existing:
        logger.info('no workbench server running — nothing to stop')
        return 0
    pid = _lock_pid(existing)
    port = existing.get('port')
    if not _process_alive(pid):
        _clear_lock(lock_file)
        logger.info('workbench server already stopped; cleared stale lock')
        return 0
    # Graceful first: the server flushes and releases its own lock.
    if port:
        try:
            req = urllib.request.Request(
                f'http://127.0.0.1:{port}/api/shutdown',
                data=b'{"reason": "cli-shutdown"}',
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            urllib.request.urlopen(req, timeout=3)
        except OSError:
            pass  # server may already be exiting; fall through to the kill path
    for _ in range(20):  # up to ~2s for the graceful exit to land
        if not _process_alive(pid):
            break
        time.sleep(0.1)
    if _process_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    _clear_lock(lock_file)
    logger.info('workbench server stopped (pid=%s)', pid)
    return 0


def _open_browser_async(url: str, delay: float = 0.4) -> None:
    """Open the browser after Flask has had a moment to bind its socket."""
    def _open() -> None:
        time.sleep(delay)
        open_preview_browser(url, logger=logger)

    threading.Thread(target=_open, daemon=True).start()


def create_app(
    projects_root: str,
    idle_timeout: int = DEFAULT_IDLE_TIMEOUT,
    lock_file: Optional[Path] = None,
    server_port: Optional[int] = None,
) -> Flask:
    """Create and configure the Flask app for a projects root directory."""
    projects_path = Path(projects_root).resolve()
    runtime_dir = _workbench_dir(projects_path)

    app = Flask(__name__, static_folder='static', static_url_path='/static')
    app.config['PROJECTS_ROOT'] = projects_path
    app.config['RUNTIME_DIR'] = runtime_dir
    app.config['LOCK_FILE'] = lock_file
    app.config['SERVER_PORT'] = server_port
    app.config['LAST_REQUEST_TIME'] = time.time()
    app.config['MAX_CONTENT_LENGTH'] = MAX_UPLOAD_BYTES

    @app.before_request
    def _update_activity():
        allowed_hosts = {PUBLIC_HOST, 'localhost', '::1', '[::1]'}
        host = request.headers.get('Host', '').lower()
        if host.startswith('[') or host.count(':') == 1:
            host = re.sub(r':\d+$', '', host)
        if host not in allowed_hosts:
            return jsonify({'error': 'Forbidden Host header'}), 403
        origin = request.headers.get('Origin')
        if origin is not None:
            try:
                origin_host = urllib.parse.urlsplit(origin).hostname
            except ValueError:
                origin_host = None
            if origin_host not in allowed_hosts:
                return jsonify({'error': 'Forbidden Origin header'}), 403
        app.config['LAST_REQUEST_TIME'] = time.time()

    def _exit_with_lock_release(code: int = 0) -> None:
        lf = app.config.get('LOCK_FILE')
        if lf is not None:
            _release_lock(lf)
        os._exit(code)

    def _idle_watchdog():
        if idle_timeout <= 0:
            return
        while True:
            time.sleep(10)
            elapsed = time.time() - app.config['LAST_REQUEST_TIME']
            if elapsed > idle_timeout:
                logger.info('idle for %ds, shutting down', idle_timeout)
                _exit_with_lock_release(0)

    watchdog = threading.Thread(target=_idle_watchdog, daemon=True)
    watchdog.start()

    @app.route('/api/shutdown', methods=['POST'])
    def shutdown():
        data = request.get_json(silent=True) or {}
        reason = data.get('reason') or 'shutdown'

        def _stop():
            time.sleep(0.5)  # let HTTP response flush before killing the process
            logger.info('shutting down (%s)', reason)
            _exit_with_lock_release(0)
        threading.Thread(target=_stop, daemon=True).start()
        return jsonify({'status': 'ok'})

    @app.route('/')
    def index():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/api/health')
    def health():
        """Expose a cheap readiness probe for the daemon launcher."""
        resp = jsonify({
            'status': 'ok',
            'service': 'workbench',
            'pid': os.getpid(),
            'repo_root': str(_repo_root(projects_path)),
            'projects_root': str(projects_path),
            'task_count': _count_tasks(_tasks_dir(projects_path)),
        })
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/options')
    def get_options():
        """Serve the option universe; canvas syncs live from config.py."""
        try:
            static_options = _read_json_object(_OPTIONS_PATH, retries=0)
        except (OSError, json.JSONDecodeError, ValueError):
            static_options = {}
        canvas_labels = static_options.get('canvas_labels') or {}
        canvas = [
            {
                'id': key,
                'label': canvas_labels.get(key) or fmt.get('name') or key,
                'dimensions': fmt.get('dimensions'),
                'aspect_ratio': fmt.get('aspect_ratio'),
                'use_case': fmt.get('use_case'),
            }
            for key, fmt in CANVAS_FORMATS.items()
        ]
        resp = jsonify({
            'canvas': canvas,
            'page_counts': static_options.get('page_counts', []),
            'image_policies': static_options.get('image_policies', []),
            'languages': static_options.get('languages', []),
        })
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks', methods=['GET'])
    def list_tasks():
        """Summarize every task, newest first."""
        resp = jsonify({'tasks': _list_task_summaries(projects_path)})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks', methods=['POST'])
    def create_task():
        """Create one draft task from a topic (and optional initial params)."""
        data = request.get_json(silent=True) or {}
        topic = data.get('topic')
        if not isinstance(topic, str) or not topic.strip():
            return jsonify({'error': 'topic must be a non-empty string'}), 400
        title = data.get('display_title')
        if title is not None and (not isinstance(title, str) or len(title) > 200):
            return jsonify({'error': 'display_title must be a string of at most 200 characters'}), 400
        task_id = _new_task_id()
        task = _default_task(task_id, topic.strip(), title.strip() if isinstance(title, str) else None)
        if isinstance(data.get('params'), dict):
            error = _apply_params_patch(task['params'], data['params'])
            if error:
                return jsonify({'error': error}), 400
        task_dir = _task_dir_path(projects_path, task_id)
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / UPLOADS_DIR_NAME).mkdir(exist_ok=True)
        _write_json_atomic(_task_file_path(projects_path, task_id), task)
        return jsonify({'task_id': task_id}), 201

    def _load_task_or_abort(task_id: str):
        """Return (task, task_dir, error_response); exactly one is set."""
        if TASK_ID_RE.fullmatch(task_id) is None:
            return None, None, (jsonify({'error': 'invalid task id'}), 404)
        task_dir = _task_dir_path(projects_path, task_id)
        task_file = task_dir / TASK_FILE_NAME
        if not task_file.is_file():
            return None, task_dir, (jsonify({'error': 'task not found'}), 404)
        try:
            task = _read_json_object(task_file)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            return None, task_dir, (jsonify({'error': f'invalid task.json: {exc}'}), 500)
        return task, task_dir, None

    @app.route('/api/tasks/<task_id>', methods=['GET'])
    def get_task(task_id: str):
        """Return the full task record plus the staged uploads listing."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        payload = dict(task)
        payload['uploads_present'] = _uploads_listing(task_dir)
        resp = jsonify(payload)
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>', methods=['PATCH'])
    def patch_task(task_id: str):
        """Merge user-domain edits; rejected once the task is submitted."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('status') != 'draft':
            return jsonify({'error': 'only draft tasks can be edited'}), 409
        error = _apply_user_patch(task, request.get_json(silent=True))
        if error:
            return jsonify({'error': error}), 400
        task['updated_at'] = _now_iso()
        _write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'status': 'ok'})

    @app.route('/api/tasks/<task_id>/uploads', methods=['POST'])
    def upload_files(task_id: str):
        """Stage raw source material files; never converts anything."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('status') != 'draft':
            return jsonify({'error': 'only draft tasks accept uploads'}), 409
        files = list(request.files.values()) if request.files else []
        if not files:
            return jsonify({'error': 'no files in request'}), 400
        uploads_dir = task_dir / UPLOADS_DIR_NAME
        uploads_dir.mkdir(parents=True, exist_ok=True)
        saved = []
        for storage in files:
            name = _sanitize_upload_name(storage.filename)
            if not name:
                return jsonify({'error': f'invalid file name: {storage.filename!r}'}), 400
            target = _unique_upload_path(uploads_dir, name)
            storage.save(target)
            saved.append({'name': target.name, 'size': target.stat().st_size})
        task['updated_at'] = _now_iso()
        _write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'uploads': saved}), 201

    @app.route('/api/tasks/<task_id>/uploads/<path:name>', methods=['DELETE'])
    def delete_upload(task_id: str, name: str):
        """Remove one staged upload; rejected once the task is submitted."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('status') != 'draft':
            return jsonify({'error': 'only draft tasks accept upload changes'}), 409
        uploads_dir = task_dir / UPLOADS_DIR_NAME
        target = (uploads_dir / name).resolve()
        if target.parent != uploads_dir.resolve() or not target.is_file():
            return jsonify({'error': 'upload not found'}), 404
        try:
            target.unlink()
        except OSError as exc:
            return jsonify({'error': f'cannot delete file: {exc}'}), 500
        task['updated_at'] = _now_iso()
        _write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'status': 'ok'})

    @app.route('/api/tasks/<task_id>/submit', methods=['POST'])
    def submit_task(task_id: str):
        """Freeze the user domain and hand the task to the waiting agent."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('status') != 'draft':
            return jsonify({'error': f'task is already {task.get("status")}'}), 409
        error = _submit_error(task)
        if error:
            return jsonify({'error': error}), 400
        task['status'] = 'submitted'
        task['submitted_at'] = _now_iso()
        task['updated_at'] = task['submitted_at']
        task['uploads'] = _uploads_listing(task_dir)
        _write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({
            'status': 'submitted',
            'task_id': task_id,
            'agent_hint': AGENT_HINT_TEMPLATE.format(task_id=task_id),
        })

    @app.route('/api/templates', methods=['GET'])
    def get_templates():
        """Serve the four-kind template catalog from the library indexes."""
        resp = jsonify(_template_market())
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/templates/<kind>/<template_id>/preview', methods=['GET'])
    def get_template_preview(kind: str, template_id: str):
        """Serve one template's preview payload (roster urls or identity card)."""
        payload = _template_preview_payload(kind, template_id)
        if payload is None:
            return jsonify({'error': 'unknown template'}), 404
        resp = jsonify(payload)
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/templates/<kind>/<template_id>/<path:filename>', methods=['GET'])
    def get_template_file(kind: str, template_id: str, filename: str):
        """Serve one whitelisted file from a registered template workspace.

        The gate is the index itself: kind must be one of the four library
        directories and template_id must be a key in that kind's index. Deck
        SVG ``../images/*`` references resolve through this route.
        """
        if _template_index_entry(kind, template_id) is None:
            return jsonify({'error': 'unknown template'}), 404
        workspace_root = _template_workspace_root(kind, template_id)
        if not workspace_root.is_dir():
            return jsonify({'error': 'unknown template'}), 404
        return send_from_directory(workspace_root, filename)

    @app.route('/api/custom-templates', methods=['GET'])
    def list_custom_templates():
        """List saved custom templates (combination presets), newest first."""
        records = _load_custom_templates(projects_path)
        resp = jsonify({'custom_templates': [
            _custom_template_payload(record) for record in records
        ]})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/custom-templates', methods=['POST'])
    def create_custom_template():
        """Save a new custom template from (kind, id) selection pairs."""
        data = request.get_json(silent=True) or {}
        records = _load_custom_templates(projects_path)
        name, error, resolved, clash = _validate_custom_template_fields(
            records, data.get('name'), data.get('selections'), None,
        )
        if clash is not None:
            return jsonify({
                'error': 'name already exists',
                'existing_id': clash.get('id'),
            }), 409
        if error:
            return jsonify({'error': error}), 400
        if not resolved:
            return jsonify({'error': 'selections is required'}), 400
        now = _now_iso()
        record = {
            'schema_version': CUSTOM_TEMPLATE_SCHEMA_VERSION,
            'id': _new_custom_template_id(),
            'name': name,
            'selections': [
                {'kind': item['kind'], 'id': item['id']} for item in resolved
            ],
            'indexes_sha256': _indexes_sha256(),
            'created_at': now,
            'updated_at': now,
        }
        _write_json_atomic(
            _custom_template_file_path(projects_path, record['id']), record,
        )
        return jsonify(_custom_template_payload(record)), 201

    @app.route('/api/custom-templates/<ct_id>', methods=['PUT'])
    def update_custom_template(ct_id: str):
        """Rename and/or re-pick one saved custom template."""
        if CUSTOM_TEMPLATE_ID_RE.fullmatch(ct_id) is None:
            return jsonify({'error': 'unknown custom template'}), 404
        path = _custom_template_file_path(projects_path, ct_id)
        if not path.is_file():
            return jsonify({'error': 'unknown custom template'}), 404
        record = _read_json_object(path)
        data = request.get_json(silent=True) or {}
        records = _load_custom_templates(projects_path)
        new_name = record.get('name') if 'name' not in data else data.get('name')
        selections = (
            record.get('selections') if 'selections' not in data
            else data.get('selections')
        )
        name, error, resolved, clash = _validate_custom_template_fields(
            records, new_name, selections, exclude_id=ct_id,
        )
        if clash is not None:
            return jsonify({
                'error': 'name already exists',
                'existing_id': clash.get('id'),
            }), 409
        if error:
            return jsonify({'error': error}), 400
        record['name'] = name
        if resolved:
            record['selections'] = [
                {'kind': item['kind'], 'id': item['id']} for item in resolved
            ]
        record['updated_at'] = _now_iso()
        _write_json_atomic(path, record)
        return jsonify(_custom_template_payload(record))

    @app.route('/api/custom-templates/<ct_id>', methods=['DELETE'])
    def delete_custom_template(ct_id: str):
        """Delete one saved custom template."""
        if CUSTOM_TEMPLATE_ID_RE.fullmatch(ct_id) is None:
            return jsonify({'error': 'unknown custom template'}), 404
        path = _custom_template_file_path(projects_path, ct_id)
        if not path.is_file():
            return jsonify({'error': 'unknown custom template'}), 404
        for attempt in range(5):
            try:
                path.unlink()
                return jsonify({'deleted': ct_id})
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.06)
        return jsonify({'error': 'unable to delete'}), 500

    def _project_dir_or_abort(task: dict):
        """Return the task's project Path or a 409 response tuple."""
        project_dir = task.get('project_dir')
        if not project_dir or not Path(project_dir).is_dir():
            return None, (jsonify({'error': 'task has no project directory yet'}), 404)
        return Path(project_dir), None

    @app.route('/api/tasks/<task_id>/progress', methods=['GET'])
    def get_task_progress(task_id: str):
        """Derive the read-only progress view from the project tree."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        resp = jsonify(_task_progress_payload(task, task_dir))
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>/slides/<name>', methods=['GET'])
    def get_task_slide(task_id: str, name: str):
        """Serve one generated page SVG from the project's svg_output/."""
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if _SLIDE_NAME_RE.fullmatch(name) is None:
            return jsonify({'error': 'invalid slide name'}), 404
        project_path, error = _project_dir_or_abort(task)
        if error:
            return error
        return send_from_directory(project_path / 'svg_output', name)

    @app.route('/api/tasks/<task_id>/exports/<name>', methods=['GET'])
    def get_task_export(task_id: str, name: str):
        """Serve one exported PPTX from the project's exports/."""
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if _EXPORT_NAME_RE.fullmatch(name) is None:
            return jsonify({'error': 'invalid export name'}), 404
        project_path, error = _project_dir_or_abort(task)
        if error:
            return error
        return send_from_directory(project_path / 'exports', name, as_attachment=True)

    @app.route('/api/tasks/<task_id>/images/<path:filename>', methods=['GET'])
    def get_task_image(task_id: str, filename: str):
        """Serve one image asset so inline page SVG previews resolve."""
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        project_path, error = _project_dir_or_abort(task)
        if error:
            return error
        return send_from_directory(project_path / 'images', filename)

    @app.route('/api/tasks/<task_id>/feedback', methods=['GET'])
    def get_task_feedback(task_id: str):
        """Read feedback.json if present."""
        _task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        feedback = _read_feedback(task_dir)
        resp = jsonify(feedback if feedback is not None else {'exists': False})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>/feedback', methods=['POST'])
    def post_task_feedback(task_id: str):
        """Write or update feedback.json (allowed at any status)."""
        _task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        data = request.get_json(silent=True) or {}
        rating = data.get('rating')
        if rating is not None:
            if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                return jsonify({'error': 'rating must be an integer 1..5'}), 400
        comment = data.get('comment')
        if comment is not None and not isinstance(comment, str):
            return jsonify({'error': 'comment must be a string'}), 400
        wants_revision = data.get('wants_revision')
        if wants_revision is not None and not isinstance(wants_revision, bool):
            return jsonify({'error': 'wants_revision must be a boolean'}), 400
        _write_json_atomic(task_dir / FEEDBACK_FILE_NAME, {
            'schema_version': 1,
            'rating': rating,
            'comment': comment if comment is not None else '',
            'wants_revision': bool(wants_revision),
            'submitted_at': _now_iso(),
        })
        return jsonify({'status': 'ok'})

    return app


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='PPT Master repository-level workbench UI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        '--port', type=int, default=None,
        help=f'Exact port to listen on (default: first free port from {DEFAULT_PORT})',
    )
    parser.add_argument('--no-browser', action='store_true', help='Do not auto-open browser')
    parser.add_argument(
        '--daemon', action='store_true',
        help='Start the server in the background and return once it is reachable',
    )
    parser.add_argument(
        '--timeout', type=int, default=DEFAULT_IDLE_TIMEOUT,
        help=f'Server idle auto-shutdown in seconds (default: {DEFAULT_IDLE_TIMEOUT} = disabled)',
    )
    parser.add_argument(
        '--shutdown', action='store_true',
        help='Stop a running workbench server, then exit (idempotent)',
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] workbench: %(message)s',
        datefmt='%H:%M:%S',
    )
    plain_request_log()

    if args.port is not None:
        try:
            args.port = _validate_port(args.port)
        except ValueError as exc:
            logger.error('%s', exc)
            return 2

    projects_root = DEFAULT_PROJECTS_ROOT
    lock_file = _workbench_dir(projects_root) / LOCK_FILE_NAME

    # Cleanup path: stop any lingering workbench server and exit.
    if args.shutdown:
        return _shutdown_existing(lock_file)

    if args.daemon:
        runtime_dir = _workbench_dir(projects_root)
        existing = _read_lock(lock_file)
        if existing and _process_alive(_lock_pid(existing)):
            logger.error(
                'workbench is already running (pid=%s, port=%s). Open %s',
                existing.get('pid', '?'), existing.get('port', '?'),
                _server_url(int(existing.get('port') or DEFAULT_PORT)),
            )
            return 1
        try:
            _proc, port, _log = _launch_background_server(
                projects_root,
                preferred_port=args.port if args.port is not None else DEFAULT_PORT,
                exact_port=args.port is not None,
                idle_timeout=args.timeout,
                open_browser=not args.no_browser,
            )
        except RuntimeError as exc:
            logger.error('%s', exc)
            return 1
        return 0

    try:
        port = args.port if args.port is not None else _find_free_port(DEFAULT_PORT)
    except RuntimeError as exc:
        logger.error('%s', exc)
        return 1

    # Repository-level mutual exclusion: refuse duplicate launches. Stale
    # locks (dead pid) are overwritten by _claim_lock.
    existing = _claim_lock(lock_file, port)
    if existing:
        logger.error(
            'workbench is already running (pid=%s, port=%s). Open %s, or run: kill %s',
            existing.get('pid', '?'), existing.get('port', '?'),
            _server_url(int(existing.get('port') or port)), existing.get('pid', '?'),
        )
        return 1
    atexit.register(_release_lock, lock_file)

    def _on_sigterm(signum: int, _frame) -> None:
        logger.info('received signal %s, exiting', signum)
        sys.exit(0)
    try:
        signal.signal(signal.SIGTERM, _on_sigterm)
    except (ValueError, OSError):
        pass

    app = create_app(
        str(projects_root),
        idle_timeout=args.timeout,
        lock_file=lock_file,
        server_port=port,
    )

    url = _server_url(port)
    if not args.no_browser:
        _open_browser_async(url)

    logger.info('running at %s', url)
    logger.info('projects: %s', projects_root)
    logger.info('idle timeout: %ds (0 = disabled)', args.timeout)
    app.run(host=PUBLIC_HOST, port=port, debug=False)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
