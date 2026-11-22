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
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Optional

from flask import Flask, jsonify, request, send_from_directory

# Local — sys.path injection for sibling module (code-style.md §3)
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import agent_bridge  # noqa: E402
from apply_template import (  # noqa: E402
    INSTALL_RECEIPT_NAME,
    ApplyTemplateError,
    apply_templates,
    read_template_install,
    snapshot_template_roots,
)
import workbench_agent  # noqa: E402
from workbench import codex_dispatch  # noqa: E402
from workbench.image_progress import project_image_progress  # noqa: E402
from workbench.powerpoint_preview import PreviewRenderer  # noqa: E402
from slide_roster import discover_slide_svgs  # noqa: E402
from atomic_io import write_bytes_atomic, write_json_atomic  # noqa: E402
from config import CANVAS_FORMATS, resolve_env_path, strip_env_quotes, strip_inline_env_comment  # noqa: E402
from image_backends import backend_zzai
from workbench.image_prices import daily_prices, RESOLUTIONS
from image_gen import BACKEND_ALIASES, BACKEND_REGISTRY  # noqa: E402
from confirm_ui.outline_store import (  # noqa: E402
    OutlineConflictError,
    confirm_outline,
    extract_outline_preview_sample,
    get_workbench_stage1_prefs,
    outline_summary,
    read_outline_view,
    save_user_outline,
    set_workbench_stage1_prefs,
    submit_outline_revision,
    valid_visual_style_ids,
)
from console_encoding import configure_utf8_stdio  # noqa: E402
from surface_mount import mount_surfaces  # noqa: E402
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
AGENTS_DIR_NAME = 'agents'
ASSIGNMENTS_DIR_NAME = 'assignments'
# An agent advertises itself by heartbeating; missing two beats means offline.
AGENT_ONLINE_SECONDS = 45
# A dispatch survives long enough for the agent to open the task and bind a run.
ASSIGNMENT_TTL_SECONDS = 180
TASK_FILE_NAME = 'task.json'
FEEDBACK_FILE_NAME = 'feedback.json'
UPLOADS_DIR_NAME = 'uploads'
TASK_SCHEMA_VERSION = 5
# task.json carries the user's own decisions only. Run state — stage, progress,
# errors, deliverables — lives in the project's `.runtime/` and is derived, so
# the server and the agent never write the same file.
USER_DOMAIN_FIELDS = (
    'schema_version',
    'task_id',
    'created_at',
    'updated_at',
    'submitted_at',
    'display_title',
    'topic',
    'example_id',
    'params',
    'uploads',
)
LOCK_FILE_NAME = 'workbench.lock'
SERVER_LOG_NAME = 'server.log'

# Task registry shape. Task ids are pure ASCII (generated); user text lives
# only inside task.json values so Chinese titles never become path segments.
TASK_ID_RE = re.compile(r't\d{8}-\d{6}-[0-9a-f]{4}\Z')
# Project slugs are directory names under projects/; the agent-facing routes
# resolve them against that root and never accept a separator. CJK is allowed
# because project slugs are user-chosen (registered brand roots use it).
_SLUG_RE = re.compile(r'[A-Za-z0-9._\-一-鿿]+\Z')
# Inbox request ids are generated counters; a path separator must never pass.
_REQUEST_ID_RE = re.compile(r'\d{1,9}\Z')
# Saved custom templates ("我的模板") follow the same generated-id discipline:
# one JSON file per record under .workbench/custom_templates/, name is data.
IMAGE_POLICY_VALUES = {'auto', 'none', 'web', 'ai'}
PAGE_COUNT_MIN = 1
PAGE_COUNT_MAX = 60
AGENT_HINT_TEMPLATE = """请接手 newbie-ppt 仓库中的一个工作台任务（任务号 {task_id}）。

仓库根目录：{repo_root}
任务文件：projects/.workbench/tasks/{task_id}/task.json（只读，含主题、画幅、页数、语言、配图、讲者备注；附件在同目录 uploads/）
任务页面：{base_url}/#/task/{task_id}（用户在这里确认阶段、查看预览与交付物）

执行要求：
1. 先读 skills/ppt-master/SKILL.md，按 skills/ppt-master/workflows/generate-pptx.md 的 Generate PPTX 流程推进，不要跳过阶段门。
2. 先检查是否已有本次运行：projects/ 下某项目的 .runtime/status.json 中 task_id 等于 {task_id}。
   - 有：说明此前中断过。用 agent_bridge.py show --project <项目路径> 查看状态，再用 agent_bridge.py run start --resume --project <项目路径> 接续；不要从零重来，已确认的选择保留。
   - 没有：新建项目（project_manager.py init <名称>），然后运行
     agent_bridge.py run start --project <项目路径> --task {task_id}
     把本次运行绑定到该任务，网页会自动显示进度。
3. 对于 example_id 任务，按任务 params.canvas 初始化项目，根据新材料拟定页数和 outline.md，等待用户确认大纲（confirm_ui/wait.py --stage outline）。确认时工作台会安装所选资源：有 example_reference.json 时，读取其中的逐页 SVG 排版、预览位置和设计资料，为新主题设计可编辑页面；有 template_install.json 时，使用 templates/ 中的规范及版式。按已委托的方案配图、逐页绘制、校验与导出。每页完成后报告进度。详见 scripts/docs/workbench.md。
4. 无 example_id 的旧任务依已有确认流程接续。导出到项目 exports/ 后报告完成。"""

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
def _examples() -> dict[str, dict]:
    catalog = Path(__file__).parent / 'static' / 'examples' / 'catalog.json'
    return {entry['id']: entry for entry in json.loads(catalog.read_text(encoding='utf-8'))}


def _install_example(project: Path, example_id: str) -> None:
    example = _examples().get(example_id)
    if example is None:
        raise ValueError('所选示例已不可用')
    if 'reference_sha256' in example:
        target = project / 'example_reference.json'
        bundle = Path(__file__).parent / 'example_sources' / (example_id + '.json')
        try:
            payload = (target if target.exists() else bundle).read_bytes()
            if hashlib.sha256(payload).hexdigest() != example['reference_sha256']:
                raise ApplyTemplateError('原例排版资料与目录记录不一致')
            if not target.exists():
                write_bytes_atomic(target, payload)
        except OSError as exc:
            raise ApplyTemplateError(f'无法读取或安装原例排版资料：{exc}') from exc
        return
    roots = [str(_SKILL_DIR / 'templates' / 'decks' / example_id)]
    if (project / INSTALL_RECEIPT_NAME).is_file():
        read_template_install(project, snapshot_template_roots(project, roots), None)
    else:
        apply_templates(project, roots)


_TEMPLATE_INDEX_PATHS = {
    'brand': _SKILL_DIR / 'templates' / 'brands' / 'brands_index.json',
    'style': _SKILL_DIR / 'templates' / 'styles' / 'styles_index.json',
    'layout': _SKILL_DIR / 'templates' / 'layouts' / 'layouts_index.json',
    'deck': _SKILL_DIR / 'templates' / 'decks' / 'decks_index.json',
}


def _template_catalog_meta() -> dict[str, dict]:
    """Build display metadata per registered candidate without touching options_sha256."""
    try:
        static_options = _read_json_object(_OPTIONS_PATH, retries=0)
    except (OSError, json.JSONDecodeError, ValueError):
        static_options = {}
    localized_root = static_options.get('template_catalog') or {}
    meta: dict[str, dict] = {}
    for kind, index_path in _TEMPLATE_INDEX_PATHS.items():
        try:
            index_data = _read_json_object(index_path, retries=0)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        localized_kind = localized_root.get(kind) if isinstance(localized_root, dict) else None
        if not isinstance(localized_kind, dict):
            localized_kind = {}
        for template_id, entry in index_data.items():
            if not isinstance(entry, dict):
                continue
            loc = localized_kind.get(template_id)
            if not isinstance(loc, dict):
                loc = {}
            primary_color = entry.get('primary_color')
            canvas_format = entry.get('canvas_format')
            page_count = entry.get('page_count')
            meta[f'library:{kind}:{template_id}'] = {
                'title': str(loc.get('title') or template_id),
                'desc': str(loc.get('desc') or entry.get('summary') or ''),
                'primary_color': primary_color if isinstance(primary_color, str) else None,
                'canvas_format': canvas_format if isinstance(canvas_format, str) else None,
                'page_count': page_count if isinstance(page_count, int) and not isinstance(page_count, bool) else None,
            }
    return meta



def _repo_root(projects_root: Path) -> Path:
    """Return the repository root that owns a projects root."""
    return projects_root.parent


def _workbench_dir(projects_root: Path) -> Path:
    """Return the workbench runtime directory for a projects root."""
    return projects_root / WORKBENCH_DIR_NAME


def _tasks_dir(projects_root: Path) -> Path:
    """Return the task registry directory for a projects root."""
    return _workbench_dir(projects_root) / TASKS_DIR_NAME




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


def _agents_dir(projects_root: Path) -> Path:
    return projects_root / WORKBENCH_DIR_NAME / AGENTS_DIR_NAME


def _assignments_dir(projects_root: Path) -> Path:
    return projects_root / WORKBENCH_DIR_NAME / ASSIGNMENTS_DIR_NAME


def _iso_after(seconds: int) -> str:
    return (datetime.now() + timedelta(seconds=seconds)).isoformat(timespec='seconds')


def _agent_online(record: dict) -> bool:
    try:
        last = datetime.fromisoformat(str(record.get('last_seen')))
    except (TypeError, ValueError):
        return False
    return (datetime.now() - last).total_seconds() <= AGENT_ONLINE_SECONDS


def _list_agents(projects_root: Path) -> list[dict]:
    # Presence files are disposable: a live agent rewrites its own every beat.
    agents = []
    for path in sorted(_agents_dir(projects_root).glob('*.json')):
        record = _read_json_object(path)
        if not record.get('agent_id'):
            continue
        record['online'] = _agent_online(record)
        agents.append(record)
    agents.sort(key=lambda item: str(item.get('last_seen') or ''), reverse=True)
    return agents


def _assignment_for(projects_root: Path, task_id: str) -> Optional[dict]:
    path = _assignments_dir(projects_root) / f'{task_id}.json'
    if not path.is_file():
        return None
    record = _read_json_object(path)
    if record.get('agent_id') == codex_dispatch.AGENT_ID:
        if record.get('phase') == 'accepted' and not _process_alive(record.get('pid')):
            record['phase'] = 'stopped'
        return record
    try:
        expires = datetime.fromisoformat(str(record.get('expires_at')))
    except (TypeError, ValueError):
        return None
    if expires < datetime.now():
        try:
            path.unlink()
        except OSError:
            pass
        return None
    return record


def _clear_assignment(projects_root: Path, task_id: str) -> bool:
    path = _assignments_dir(projects_root) / f'{task_id}.json'
    if not path.is_file():
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _now_iso() -> str:
    """Return the local timestamp format used across task.json fields."""
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def _new_task_id() -> str:
    """Generate a fresh ASCII task id (date-time plus short random suffix)."""
    return f't{datetime.now().strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(2)}'




def _task_dir_path(projects_root: Path, task_id: str) -> Path:
    """Return one task's directory; callers validate the id shape first."""
    return _tasks_dir(projects_root) / task_id


def _task_file_path(projects_root: Path, task_id: str) -> Path:
    """Return one task's task.json path."""
    return _task_dir_path(projects_root, task_id) / TASK_FILE_NAME




























def _default_task(task_id: str, topic: str, display_title: Optional[str]) -> dict:
    """Build a fresh draft task record holding only the user domain."""
    now = _now_iso()
    return {
        'schema_version': TASK_SCHEMA_VERSION,
        'task_id': task_id,
        'created_at': now,
        'submitted_at': None,
        'updated_at': now,
        'display_title': display_title,
        'topic': topic,
        'example_id': None,
        'params': {
            'canvas': 'ppt169',
            'page_count': None,
            'primary_language': 'zh-CN',
            'speaker_notes': False,
            'image_policy': 'ai',
        },
        'uploads': [],
    }


def _normalize_task(raw: dict) -> dict:
    """Rebuild a task record from its user domain, dropping anything else.

    Older records carried run state (``status``, ``agent_log``, ``project_dir``
    …). Run state is now derived from the project's ``.runtime/``, so those
    keys are discarded on read instead of being carried forward.
    """
    task = _default_task(
        str(raw.get('task_id') or ''),
        str(raw.get('topic') or ''),
        raw.get('display_title'),
    )
    for key in USER_DOMAIN_FIELDS:
        if key in raw:
            task[key] = raw[key]
    task['schema_version'] = TASK_SCHEMA_VERSION
    return task


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
    if 'example_id' in payload:
        example_id = payload['example_id']
        example = _examples().get(example_id) if isinstance(example_id, str) else None
        if example is None:
            return '未知示例'
        if task.get('example_id') and example_id != task['example_id']:
            return 'the selected example cannot be changed on this draft'
        if not task.get('example_id'):
            task['example_id'] = example_id
            task['params']['canvas'] = example['canvas']
    if 'topic' in payload:
        topic = payload['topic']
        if not isinstance(topic, str) or (not task.get('example_id') and not topic.strip()):
            return 'topic must be a non-empty string'
        task['topic'] = topic.strip()
    if 'params' in payload:
        error = _apply_params_patch(task['params'], payload['params'])
        if error:
            return error
    return None


def _submit_error(task: dict) -> Optional[str]:
    """Return the blocking error for a draft submission, or None."""
    if not str(task.get('topic') or '').strip() and not task.get('uploads'):
        return 'topic is required before submitting'
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


def _list_project_views(projects_root: Path) -> list:
    """Read one run view per project directory, newest activity first.

    A project is listed when it has a `.runtime/` (the agent reported on it) or
    an `svg_output/` (it produced pages). Nothing here writes to the project.
    """
    views = []
    try:
        children = sorted(projects_root.iterdir())
    except OSError:
        return views
    for child in children:
        if not child.is_dir() or child.name.startswith('.'):
            continue
        if not (child / agent_bridge.RUNTIME_DIRNAME).is_dir() and not (child / 'svg_output').is_dir():
            continue
        try:
            view = agent_bridge.effective_state(agent_bridge.Paths(child))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        views.append({
            'slug': child.name,
            'project_dir': str(child),
            'view': view,
        })
    views.sort(key=lambda item: (item['view'] or {}).get('updated_at') or '', reverse=True)
    return views


def _runtime_index(projects_root: Path) -> dict:
    """Map task id -> project view for every project that declares a binding.

    The binding is written by the agent (`agent_bridge.py run start --task`),
    so the server never has to remember where a task's project went. This is
    the only join between the user domain and the run state.
    """
    return {
        entry['view']['task_id']: entry
        for entry in _list_project_views(projects_root)
        if entry['view'].get('task_id')
    }


def _resolve_project_path(projects_root: Path, slug: str) -> tuple[Optional[Path], Optional[tuple]]:
    """Resolve one project directory by slug, refusing anything outside the root."""
    if _SLUG_RE.fullmatch(slug) is None or slug in ('.', '..'):
        return None, (jsonify({'error': 'invalid project slug'}), 404)
    candidate = (projects_root / slug).resolve()
    try:
        candidate.relative_to(projects_root.resolve())
    except ValueError:
        return None, (jsonify({'error': 'invalid project slug'}), 404)
    if not candidate.is_dir():
        return None, (jsonify({'error': 'unknown project'}), 404)
    return candidate, None


def _derived_state(task: dict, runtime: Optional[dict]) -> str:
    """Derive the task state: user facts first, then the run's own view."""
    if not task.get('submitted_at'):
        return 'draft'
    if not runtime:
        return 'submitted'
    return {
        'idle': 'submitted',
        'running': 'processing',
        'waiting_user': 'processing',
        'interrupted': 'interrupted',
        'failed': 'failed',
        'done': 'done',
    }.get((runtime.get('view') or {}).get('state'), 'submitted')


def _runtime_summary(runtime: Optional[dict]) -> dict:
    """Return the compact run view carried by task responses."""
    if not runtime:
        return {
            'slug': None,
            'project_dir': None,
            'stage': None,
            'stage_index': None,
            'stage_label': None,
            'state': None,
            'progress': None,
            'blocking': None,
            'error': None,
            'updated_at': None,
        }
    view = runtime.get('view') or {}
    return {
        'slug': runtime.get('slug'),
        'project_dir': runtime.get('project_dir'),
        'stage': view.get('stage'),
        'stage_index': view.get('stage_index'),
        'stage_label': view.get('stage_label'),
        'state': view.get('state'),
        'progress': view.get('progress'),
        'blocking': view.get('blocking'),
        'error': view.get('error'),
        'updated_at': view.get('updated_at'),
    }


def _list_task_summaries(projects_root: Path) -> list:
    """Summarize every task record, newest first, skipping junk entries."""
    registry = _tasks_dir(projects_root)
    summaries = []
    if not registry.is_dir():
        return summaries
    runtime_index = _runtime_index(projects_root)
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
                'runtime': _runtime_summary(None),
            })
            continue
        task = _normalize_task(data)
        runtime = runtime_index.get(task.get('task_id') or entry.name)
        summary = _runtime_summary(runtime)
        status = _derived_state(task, runtime)
        summaries.append({
            'task_id': task.get('task_id') or entry.name,
            'display_title': task.get('display_title'),
            'topic': task.get('topic'),
            'status': status,
            'attention': _task_attention(status, runtime),
            'created_at': task.get('created_at'),
            'submitted_at': task.get('submitted_at'),
            'updated_at': task.get('updated_at'),
            'runtime': summary,
        })
    summaries.sort(key=lambda item: item.get('created_at') or '', reverse=True)
    return summaries


# Template market catalog cache, keyed on the four index file mtimes.
















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


@lru_cache(maxsize=512)
def _slide_ready(path: Path, mtime_ns: int, size: int) -> bool:
    """Cache XML completeness for this particular revision of a slide."""
    try:
        return ET.parse(path).getroot().tag in ('svg', '{http://www.w3.org/2000/svg}svg')
    except (ET.ParseError, OSError):
        return False


def _previewable_slides(project: Path) -> list:
    slides = []
    for path in discover_slide_svgs(project / 'svg_output'):
        if not _SLIDE_NAME_RE.fullmatch(path.name):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size and _slide_ready(path, stat.st_mtime_ns, stat.st_size):
            slides.append({'name': path.name, 'size': stat.st_size, 'mtime': stat.st_mtime,
                           'version': str(stat.st_mtime_ns)})
    return slides


def _plan_state(project_path: Path) -> dict:
    """Say whether the AI's Stage-2 plan is waiting for the user's review.

    The task page embeds the confirmation surface while this is true; the
    surface itself decides what to render, so the workbench only needs the
    two facts that make the second confirmation due: a stage-1 result and an
    authored Stage-2 recommendation.
    """
    confirm_dir = project_path / 'confirm_ui'
    try:
        result = _read_json_object(confirm_dir / 'result.json', retries=0)
    except (OSError, json.JSONDecodeError, ValueError):
        result = {}
    stage = result.get('stage')
    authored = (confirm_dir / 'recommendations.stage2.json').is_file()
    return {
        'review_due': stage == 'stage1' and authored and not get_workbench_stage1_prefs(project_path).get('skip_stage2_review'),
        'confirmed': stage == 'final',
    }


def _task_inbox(project: Path, task_id: Optional[str]) -> list:
    """Omit legacy link-only reminders that point back to this task's review UI."""
    items = []
    for item in agent_bridge.list_requests(project):
        req = item['request']
        if (req.get('kind') == 'confirm' and not req.get('options') and not req.get('body')
                and not req.get('attachments') and task_id
                and any(label in (req.get('title') or '') for label in ('「① 内容大纲」', '「② 选择模板」'))
                and (req.get('url') or '').partition('#')[2] == f'/task/{task_id}'):
            continue
        items.append(item)
    return items


def _task_attention(status: str, runtime: Optional[dict], outline=None, plan=None, inbox=None) -> Optional[str]:
    if status not in ('processing', 'interrupted') or not runtime:
        return None
    project = Path(runtime['project_dir'])
    view = runtime.get('view') or {}
    outline = outline if outline is not None else outline_summary(project)
    if outline.get('status') == 'ready':
        return 'outline'
    plan = plan if plan is not None else _plan_state(project)
    if plan['review_due']:
        return 'plan'
    confirm = project / 'confirm_ui'
    if (view.get('stage') in ('confirm_stage1', 'template_prep') or outline.get('status') == 'confirmed') and (
            (confirm / 'recommendations.stage1.json').is_file() and not (confirm / 'result.json').exists()):
        return 'template'
    if view.get('blocking'):
        if inbox is None:
            inbox = _task_inbox(project, view.get('task_id'))
        if any(not item['response'] for item in inbox):
            return 'answer'
    return None


def _task_progress_payload(task: dict, runtime: Optional[dict]) -> dict:
    """Derive the read-only progress view from the run view and project tree.

    Nothing here is written by the agent: the run view comes from
    `.runtime/status.json`, the requests from `inbox/`, and everything else is
    read off the artifacts the project itself produced.
    """
    view = (runtime or {}).get('view') or {}
    project_dir = (runtime or {}).get('project_dir')
    payload = {
        'task_id': task.get('task_id'),
        'status': _derived_state(task, runtime),
        'runtime': _runtime_summary(runtime),
        'events': [],
        'requests': [],
        'slides': [],
        'slide_count': 0,
        'image_progress': None,
        'quality': {'report_exists': False},
        'exports': [],
        'outline': None,
        'confirm': None,
        'plan': None,
        'attention': None,
    }
    if not project_dir:
        return payload
    project_path = Path(project_dir)
    payload['outline'] = outline_summary(project_path)
    payload['events'] = agent_bridge.recent_events(project_path)
    payload['requests'] = _task_inbox(project_path, task.get('task_id'))
    slides = _previewable_slides(project_path)
    payload['slides'] = slides
    payload['image_progress'] = project_image_progress(project_path)
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
    payload['plan'] = _plan_state(project_path)
    payload['attention'] = _task_attention(
        payload['status'], runtime, payload['outline'], payload['plan'], payload['requests'])
    return payload


# The Stage-1 communication contract, in the order the card renders it. These
# are the only fields the user edits in the proposal step; production details
# stay with the Strategist.
_STAGE1_PROSE_FIELDS = (
    'audience',
    'communication_intent',
    'audience_outcome',
    'core_message',
    'delivery_context',
    'artifact_afterlife',
    'content_divergence',
)
_PROSE_MAX_CHARS = 4000


def _proposal_payload(
    task: dict,
    data: dict,
    status: int,
    outline: Optional[dict] = None,
    outline_preview: Optional[dict] = None,
    preferred_visual_style: Optional[str] = None,
    stage1_confirmed: bool = False,
    delegate_stage2: bool = False,
) -> dict:
    """Shape one Stage-1 proposal for the task page, or explain its absence."""
    if status != 200:
        return {
            'available': False,
            'stage1_confirmed': stage1_confirmed,
            'delegate_stage2': delegate_stage2,
            'preferred_visual_style': preferred_visual_style,
            'reason': str(data.get('error') or f'HTTP {status}'),
        }
    if data.get('stage') != 'stage1':
        return {
            'available': False,
            'stage1_confirmed': stage1_confirmed,
            'delegate_stage2': delegate_stage2,
            'preferred_visual_style': preferred_visual_style,
            'reason': '当前没有待确认的建议。',
        }
    contract = {}
    for field in _STAGE1_PROSE_FIELDS:
        entry = data.get(field)
        if isinstance(entry, dict):
            entry = entry.get('value')
        contract[field] = '' if entry is None else str(entry)
    params = task.get('params') or {}
    preview = data.get('preview')
    suggested_title = data.get('display_title')
    resolved_title = suggested_title.strip() if isinstance(suggested_title, str) else ''
    if not resolved_title and isinstance(outline, dict) and outline.get('title'):
        resolved_title = str(outline['title']).strip()
    return {
        'available': True,
        'stage': 'stage1',
        'title': resolved_title,
        'contract': contract,
        'constraints': {
            'canvas': params.get('canvas'),
            'page_count': params.get('page_count'),
            'primary_language': params.get('primary_language'),
        },
        'outline': outline,
        'outline_preview': outline_preview,
        'preferred_visual_style': preferred_visual_style,
        'preview': preview if isinstance(preview, dict) else None,
        'template_options': data.get('template_options') or {},
        'template_meta': _template_catalog_meta(),
    }


def _rename_task(task: dict, task_dir: Path, title: object) -> Optional[str]:
    """Persist a user-confirmed title; return an error message or None.

    The title is metadata, so it stays writable after submission — the user
    confirms the AI's naming together with the contract.
    """
    if title is None:
        return None
    if not isinstance(title, str):
        return 'display_title must be a string'
    cleaned = title.strip()
    if len(cleaned) > 200:
        return 'display_title must be at most 200 characters'
    if not cleaned or cleaned == (task.get('display_title') or ''):
        return None
    task['display_title'] = cleaned
    task['updated_at'] = _now_iso()
    write_json_atomic(task_dir / TASK_FILE_NAME, task)
    return None


def _stage1_confirm_payload(task: dict, data: dict) -> tuple[Optional[dict], Optional[str]]:
    """Build the Stage-1 submission the confirmation surface expects.

    Canvas and language stay the user's own constraints: they were chosen on
    the task and render read-only, so a stale card can never overwrite them.
    """
    if not isinstance(data, dict):
        return None, 'payload must be a JSON object'
    contract = data.get('contract')
    if not isinstance(contract, dict):
        return None, 'contract must be a JSON object'
    params = task.get('params') or {}
    payload = {
        'stage': 'stage1',
        'canvas': params.get('canvas'),
        'primary_language': params.get('primary_language'),
    }
    for field in _STAGE1_PROSE_FIELDS:
        value = contract.get(field, '')
        if value is not None and not isinstance(value, str):
            return None, f'contract.{field} must be a string'
        text = (value or '').strip()
        if len(text) > _PROSE_MAX_CHARS:
            return None, f'contract.{field} is too long'
        payload[field] = text
    raw_keys = data.get('selection_keys')
    if raw_keys is None:
        keys: list = []
    elif isinstance(raw_keys, list):
        keys = raw_keys
    else:
        return None, 'selection_keys must be a list of non-empty strings'
    if any(not isinstance(key, str) or not key for key in keys):
        return None, 'selection_keys must be a list of non-empty strings'
    mode = data.get('template_mode')
    if mode is None:
        mode = 'templates' if keys else 'free_design'
    if mode not in {'free_design', 'templates'}:
        return None, 'template_mode must be free_design or templates'
    if mode == 'free_design' and keys:
        return None, 'free_design cannot carry selection_keys'
    if mode == 'templates' and not keys:
        return None, 'choose at least one template workspace'
    options_sha = data.get('options_sha256')
    if not isinstance(options_sha, str) or not options_sha:
        return None, 'options_sha256 is required'
    payload['template_selection'] = {
        'mode': mode,
        'selection_keys': list(keys),
    }
    payload['options_sha256'] = options_sha
    return payload, None


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
        '--service-only',
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
    instance = secrets.token_hex(16)
    codex_cli = codex_dispatch.executable()
    outline_install_lock = threading.Lock()
    dispatch_lock = threading.RLock()
    previews = PreviewRenderer(runtime_dir / 'page-previews')

    def codex_agent():
        try:
            enabled = _read_json_object(runtime_dir / 'codex-dispatch.json', retries=0)
        except (OSError, ValueError):
            return None
        if codex_cli and enabled.get('instance') == instance:
            return {'agent_id': codex_dispatch.AGENT_ID, 'name': enabled['name'] + '（后台）',
                    'online': True, 'host': '本机'}
        return None

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
            'instance': instance,
            'codex_dispatch': bool(codex_cli),
            'pid': os.getpid(),
            'repo_root': str(_repo_root(projects_path)),
            'projects_root': str(projects_path),
            'task_count': _count_tasks(_tasks_dir(projects_path)),
        })
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    image_settings_lock = threading.Lock()

    @app.route('/api/settings/image', methods=['GET', 'PUT', 'POST'])
    def image_settings():
        if request.method in ('POST', 'PUT'):
            if not request.is_json or request.headers.get('Origin', request.host_url.rstrip('/')) != request.host_url.rstrip('/'):
                return jsonify(error='请在本地工作台操作'), 403
        path = resolve_env_path()
        with image_settings_lock:
            try:
                content = path.read_bytes().decode('utf-8') if path.exists() else ''
                settings = {}
                # Follow the generator's first-assignment and environment precedence.
                pattern = re.compile(r'^(?P<prefix>[^\S\r\n]*(?:export +)?(?P<key>[A-Z_]+)[ \t]*=[ \t]*)(?P<raw>[^\r\n]*)', re.M)
                for entry in pattern.finditer(content):
                    key = entry['key']
                    settings.setdefault(key, strip_env_quotes(strip_inline_env_comment(entry['raw']).strip()))
                def configured(key, default=''):
                    return os.environ.get(key, settings.get(key)) or default

                active = BACKEND_ALIASES.get(configured('IMAGE_BACKEND').strip().lower())
                if request.method == 'GET' and request.args.get('view') == 'status':
                    keys = BACKEND_REGISTRY[active]['key_hint'].split(' / ') if active else []
                    return jsonify(configured=any(configured(key) for key in keys)), 200, {'Cache-Control': 'no-store'}
                selected = request.args.get('channel') or ('openai' if active == 'openai' else 'zzai')
                if selected not in ('openai', 'zzai'):
                    return jsonify(error='未知渠道'), 400
                custom = selected == 'openai'
                current_base = configured('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/') if custom else backend_zzai.BASE_URL
                prefix = 'OPENAI' if custom else 'ZZAI'
                current_key = configured(prefix + '_API_KEY')
                if request.method == 'GET':
                    edge = min(4, len(current_key) // 3)
                    mask = current_key[:edge] + '********' + (current_key[-edge:] if edge else '')
                    return jsonify(
                        active=active,
                        base_url=current_base,
                        model=configured(prefix + '_MODEL', BACKEND_REGISTRY['openai']['default_model'] if custom else backend_zzai.DEFAULT_MODEL),
                        key_mask=mask if current_key else '',
                        default_url=backend_zzai.BASE_URL, default_model=backend_zzai.DEFAULT_MODEL,
                        resolution=configured('ZZAI_RESOLUTION', '1k'),
                    ), 200, {'Cache-Control': 'no-store'}

                data = request.get_json(silent=True)
                if not isinstance(data, dict):
                    return jsonify(error='请填写生图设置'), 400
                if request.method == 'POST':
                    if data.get('action') == 'prices':
                        snapshot = daily_prices(runtime_dir, configured('ZZAI_API_KEY'),
                                                refresh_on_open=data.get('on_open') is True)
                        return jsonify(snapshot), 200, {'Cache-Control': 'no-store'}
                    if data.get('action') != 'reveal' or data.get('base_url') != current_base:
                        return jsonify(error='请重新打开设置'), 400
                    return jsonify(api_key=current_key), 200, {'Cache-Control': 'no-store'}
                base = data.get('base_url')
                if not isinstance(base, str) or not re.fullmatch(r"""https?://[^\s?#'"]+""", base):
                    return jsonify(error='请输入完整的 HTTP 或 HTTPS 接口地址'), 400
                base = base.rstrip('/')
                try:
                    parts = urllib.parse.urlsplit(base)
                    if not parts.hostname or parts.username is not None or parts.password is not None:
                        raise ValueError
                    _ = parts.port
                except ValueError:
                    return jsonify(error='接口地址格式有误'), 400
                name = 'zzai' if base == backend_zzai.BASE_URL else 'openai'
                if request.args.get('channel'):
                    if selected == 'zzai' and base != backend_zzai.BASE_URL:
                        return jsonify(error='ZhenZhen AI 使用固定的接口地址'), 400
                    name = selected
                model = data.get('model')
                if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,255}', model):
                    return jsonify(error='请输入有效的模型 ID'), 400
                prefix = name.upper()
                alias = prefix + '_API_KEY'
                desired = {'IMAGE_BACKEND': name, prefix + '_MODEL': model}
                if name == 'openai':
                    desired['OPENAI_BASE_URL'] = base
                elif 'resolution' in data:
                    if data['resolution'] not in RESOLUTIONS:
                        return jsonify(error='请选择有效分辨率'), 400
                    desired['ZZAI_RESOLUTION'] = data['resolution']
                if any(k in os.environ and os.environ[k] != v for k, v in desired.items()):
                    return jsonify(error='该设置由进程环境变量指定'), 409
                if (base != current_base or not configured(alias)) and not data.get('api_key'):
                    return jsonify(error='请输入该接口对应的 API Key'), 400
                changes = {k: v for k, v in desired.items() if k not in os.environ and settings.get(k) != v}
                if 'api_key' in data:
                    secret = data['api_key']
                    if alias in os.environ:
                        return jsonify(error='API Key 由进程环境变量指定'), 409
                    if not isinstance(secret, str) or not re.fullmatch(r"""[^\s'"\x00-\x1f\x7f]{1,4096}""", secret):
                        return jsonify(error='请输入有效的 API Key'), 400
                    if secret != configured(alias):
                        changes[alias] = f'"{secret}"' if '#' in secret else secret
                if changes:
                    newline = '\r\n' if '\r\n' in content else '\n'

                    def replace(entry):
                        value = changes.pop(entry['key'], None)
                        if value is None:
                            return entry[0]
                        raw = entry['raw']
                        original = strip_inline_env_comment(raw)
                        suffix = raw[len(original.rstrip()):]
                        return entry['prefix'] + value + suffix

                    content = pattern.sub(replace, content)
                    if changes and content and not content.endswith('\n'):
                        content += newline
                    content += ''.join(f'{k}={v}{newline}' for k, v in changes.items())
                    write_bytes_atomic(path, content.encode('utf-8'))
                return jsonify(saved=True)
            except (OSError, UnicodeError):
                return jsonify(error='无法读写生图配置文件，请检查文件权限和编码'), 500

    @app.get('/api/examples')
    def list_examples():
        return jsonify(examples=list(_examples().values()))

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
            'examples': list(_examples().values()),
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
        if not isinstance(data, dict):
            return jsonify(error='invalid task'), 400
        example_id = data.get('example_id')
        example = _examples().get(example_id) if isinstance(example_id, str) else None
        if example_id is not None and example is None:
            return jsonify(error='未知示例'), 400
        topic = data.get('topic', '')
        if not isinstance(topic, str) or (not topic.strip() and not example_id):
            return jsonify({'error': 'topic must be a non-empty string'}), 400
        title = data.get('display_title')
        if title is not None and (not isinstance(title, str) or len(title) > 200):
            return jsonify({'error': 'display_title must be a string of at most 200 characters'}), 400
        task_id = _new_task_id()
        task = _default_task(task_id, topic.strip(), title.strip() if isinstance(title, str) else None)
        if example_id:
            task['example_id'] = example_id
            task['params']['canvas'] = example['canvas']
            task['params']['image_policy'] = 'auto'
        if isinstance(data.get('params'), dict):
            error = _apply_params_patch(task['params'], data['params'])
            if error:
                return jsonify({'error': error}), 400
        task_dir = _task_dir_path(projects_path, task_id)
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / UPLOADS_DIR_NAME).mkdir(exist_ok=True)
        write_json_atomic(_task_file_path(projects_path, task_id), task)
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
            task = _normalize_task(_read_json_object(task_file))
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            return None, task_dir, (jsonify({'error': f'invalid task.json: {exc}'}), 500)
        return task, task_dir, None

    def _runtime_for(task_id: str) -> Optional[dict]:
        """Return the project run view bound to this task, if any."""
        return _runtime_index(projects_path).get(task_id)

    @app.route('/api/tasks/<task_id>', methods=['GET'])
    def get_task(task_id: str):
        """Return the user domain, its derived status, and the run view."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        runtime = _runtime_for(task_id)
        payload = dict(task)
        payload['status'] = _derived_state(task, runtime)
        payload['runtime'] = _runtime_summary(runtime)
        payload['attention'] = _task_attention(payload['status'], runtime)
        payload['uploads_present'] = _uploads_listing(task_dir)
        payload['assignment'] = _assignment_for(projects_path, task_id)
        if payload['status'] == 'submitted':
            payload['agent_hint'] = AGENT_HINT_TEMPLATE.format(
                task_id=task_id,
                repo_root=_repo_root(projects_path),
                base_url=request.host_url.rstrip('/'),
            )
        resp = jsonify(payload)
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>', methods=['PATCH'])
    def patch_task(task_id: str):
        """Merge user-domain edits; only the title survives submission.

        Everything the run depends on is frozen on submit. `display_title` is
        presentation metadata — it names the task in the rail and never reaches
        the run — so the AI may name it and the user may rename it at any time.
        """
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        payload = request.get_json(silent=True)
        if task.get('submitted_at'):
            if not isinstance(payload, dict) or set(payload) - {'display_title'}:
                return jsonify({'error': 'only the title can change after submission'}), 409
            if 'display_title' not in payload:
                return jsonify({'error': 'only the title can change after submission'}), 409
        error = _apply_user_patch(task, payload)
        if error:
            return jsonify({'error': error}), 400
        task['updated_at'] = _now_iso()
        write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'status': 'ok'})

    @app.route('/api/tasks/<task_id>/uploads', methods=['POST'])
    def upload_files(task_id: str):
        """Stage raw source material files; never converts anything."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('submitted_at'):
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
        write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'uploads': saved}), 201

    @app.route('/api/tasks/<task_id>/uploads/<path:name>', methods=['DELETE'])
    def delete_upload(task_id: str, name: str):
        """Remove one staged upload; rejected once the task is submitted."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('submitted_at'):
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
        write_json_atomic(task_dir / TASK_FILE_NAME, task)
        return jsonify({'status': 'ok'})

    @app.route('/api/tasks/<task_id>/submit', methods=['POST'])
    def submit_task(task_id: str):
        """Freeze the user domain and hand the task to the waiting agent."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('submitted_at'):
            return jsonify({'error': 'task is already submitted'}), 409
        task['uploads'] = _uploads_listing(task_dir)
        error = _submit_error(task)
        if error:
            return jsonify({'error': error}), 400
        task['submitted_at'] = _now_iso()
        task['updated_at'] = task['submitted_at']
        if not task.get('display_title') and not task['topic'] and task['uploads']:
            task['display_title'] = Path(task['uploads'][0]['name']).stem
        write_json_atomic(task_dir / TASK_FILE_NAME, task)
        if task.get('example_id'):
            managed = codex_agent()
            agents = [managed] if managed else [a for a in _list_agents(projects_path) if a.get('online')]
            if len(agents) == 1:
                with dispatch_lock:
                    dispatch_task(task_id, agents[0]['agent_id'])
        return jsonify({
            'status': 'submitted',
            'task_id': task_id,
            'agent_hint': AGENT_HINT_TEMPLATE.format(
                task_id=task_id,
                repo_root=_repo_root(projects_path),
                base_url=request.host_url.rstrip('/'),
            ),
        })

    def _project_or_abort(task_id: str):
        """Return (project Path, runtime view, error_response)."""
        runtime = _runtime_for(task_id)
        if not runtime:
            return None, None, (jsonify({'error': 'task has no project yet'}), 404)
        return Path(runtime['project_dir']), runtime, None

    @app.route('/api/tasks/<task_id>/progress', methods=['GET'])
    def get_task_progress(task_id: str):
        """Derive the read-only progress view from the run view and tree."""
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        runtime = _runtime_for(task_id)
        payload = _task_progress_payload(task, runtime)
        if runtime and request.args.get('preview') == '1':
            payload['page_preview'] = previews.view(Path(runtime['project_dir']), payload['slides'], payload['exports'])
        payload['assignment'] = _assignment_for(projects_path, task_id)
        resp = jsonify(payload)
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>/slides/<name>', methods=['GET'])
    def get_task_slide(task_id: str, name: str):
        """Serve one generated page SVG from the project's svg_output/."""
        if _SLIDE_NAME_RE.fullmatch(name) is None:
            return jsonify({'error': 'invalid slide name'}), 404
        project_path, _runtime, error = _project_or_abort(task_id)
        if error:
            return error
        return send_from_directory(project_path / 'svg_output', name)

    @app.route('/api/tasks/<task_id>/exports/<name>', methods=['GET'])
    @app.post('/api/tasks/<task_id>/exports/<name>/open', defaults={'action': 'open'})
    @app.post('/api/tasks/<task_id>/exports/<name>/save-as', defaults={'action': 'save-as'})
    def get_task_export(task_id: str, name: str, action: str = 'download'):
        """Download, open, or save a copy of one local task deliverable."""
        if _EXPORT_NAME_RE.fullmatch(name) is None:
            return jsonify({'error': 'invalid export name'}), 404
        project_path, _runtime, error = _project_or_abort(task_id)
        if error:
            return error
        directory = project_path.resolve() / 'exports'
        path = (directory / name).resolve()
        if path.parent != directory or path.name != name or not path.is_file():
            return jsonify(error='交付文件不存在'), 404
        if action == 'download':
            return send_from_directory(directory, name, as_attachment=True)
        if not request.is_json or request.headers.get('Origin') != request.host_url.rstrip('/'):
            return jsonify(error='请从本地工作台操作'), 403
        try:
            if action == 'open':
                if os.name == 'nt':
                    os.startfile(str(path))
                else:
                    opener = 'open' if sys.platform == 'darwin' else 'xdg-open'
                    subprocess.run([opener, str(path)], check=True)
                return jsonify(opened=True)

            picker = Path(__file__).with_name('save_export_dialog.py')
            result = subprocess.run(
                [sys.executable, str(picker), name], check=True, capture_output=True,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
            )
            destination = json.loads(result.stdout)
            if destination is None:
                return jsonify(saved=False)
            target = Path(destination)
            if target != path:
                write_bytes_atomic(target, path.read_bytes())
            return jsonify(saved=True)
        except (OSError, ValueError, subprocess.SubprocessError):
            logger.exception('export %s failed for %s', action, name)
            message = '无法打开文件，请检查默认演示软件。' if action == 'open' else '另存为失败，请检查保存位置。'
            return jsonify(error=message), 500

    @app.route('/api/tasks/<task_id>/images/<path:filename>', methods=['GET'])
    def get_task_image(task_id: str, filename: str):
        """Serve one image asset so inline page SVG previews resolve."""
        project_path, _runtime, error = _project_or_abort(task_id)
        if error:
            return error
        return send_from_directory(project_path / 'images', filename)

    @app.route('/api/tasks/<task_id>/requests/<req_id>', methods=['POST'])
    def answer_task_request(task_id: str, req_id: str):
        """Answer one inbox request through the task the browser is looking at."""
        project_path, _runtime, error = _project_or_abort(task_id)
        if error:
            return error
        return _answer(project_path, req_id)

    @app.route('/api/tasks/<task_id>/outline', methods=['GET'])
    def get_task_outline(task_id: str):
        """Read the slide-by-slide outline and its review/revision state."""
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        runtime = _runtime_for(task_id)
        if not runtime or not runtime.get('project_dir'):
            resp = jsonify({
                'available': False,
                'status': 'missing',
                'round': 0,
                'title': task.get('display_title') or '',
                'summary': '',
                'slide_count': 0,
                'markdown': '',
                'outline_sha256': None,
                'pending_revision': None,
                'confirmed_at': None,
                'updated_at': None,
            })
            resp.headers['Cache-Control'] = 'no-store'
            return resp
        resp = jsonify(read_outline_view(Path(runtime['project_dir'])))
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>/outline', methods=['PUT'])
    def put_task_outline(task_id: str):
        """Save direct user edits (text changes, add/delete/reorder slides) to outline.md."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        project_path, _runtime, proj_error = _project_or_abort(task_id)
        if proj_error:
            return proj_error
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'payload must be a JSON object'}), 400
        title = data.get('display_title')
        if title is not None and not isinstance(title, str):
            return jsonify({'error': 'display_title must be a string'}), 400
        if isinstance(title, str) and len(title.strip()) > 200:
            return jsonify({'error': 'display_title must be at most 200 characters'}), 400
        try:
            view = save_user_outline(project_path, data.get('markdown'))
        except OutlineConflictError as exc:
            return jsonify({'error': str(exc)}), 409
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        sync_title = title if title is not None else (view.get('title') or None)
        title_error = _rename_task(task, task_dir, sync_title)
        if title_error:
            return jsonify({'error': title_error}), 400
        return jsonify(view)

    @app.route('/api/tasks/<task_id>/outline/revise', methods=['POST'])
    def revise_task_outline(task_id: str):
        """Submit a batch of inline highlight comments / global notes for AI revision."""
        _task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        project_path, _runtime, proj_error = _project_or_abort(task_id)
        if proj_error:
            return proj_error
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'payload must be a JSON object'}), 400
        try:
            view = submit_outline_revision(
                project_path,
                data.get('comments'),
                data.get('global_note', ''),
                markdown=data.get('markdown'),
            )
        except OutlineConflictError as exc:
            return jsonify({'error': str(exc)}), 409
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        return jsonify(view)

    @app.route('/api/tasks/<task_id>/outline/confirm', methods=['POST'])
    def confirm_task_outline(task_id: str):
        """Freeze outline.md as the confirmed content baseline and unlock Step 2."""
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        project_path, _runtime, proj_error = _project_or_abort(task_id)
        if proj_error:
            return proj_error
        data = request.get_json(silent=True)
        if data is None:
            data = {}
        if not isinstance(data, dict):
            return jsonify({'error': 'payload must be a JSON object'}), 400
        title = data.get('display_title')
        if title is not None and not isinstance(title, str):
            return jsonify({'error': 'display_title must be a string'}), 400
        if isinstance(title, str) and len(title.strip()) > 200:
            return jsonify({'error': 'display_title must be at most 200 characters'}), 400
        try:
            with outline_install_lock:
                if task.get('example_id'):
                    _install_example(project_path, task['example_id'])
                view = confirm_outline(project_path, markdown=data.get('markdown'))
        except ApplyTemplateError as exc:
            return jsonify(error=f'示例版式安装失败：{exc}'), 409
        except OutlineConflictError as exc:
            return jsonify({'error': str(exc)}), 409
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400
        sync_title = title if title is not None else (view.get('title') or None)
        title_error = _rename_task(task, task_dir, sync_title)
        if title_error:
            return jsonify({'error': title_error}), 400
        return jsonify(view)

    def _confirm_surface(task_id: str):
        """Return the mounted confirmation app for one task's project."""
        runtime = _runtime_for(task_id) or {}
        slug = runtime.get('slug')
        mount = app.extensions.get('surface_mount')
        if not slug or mount is None:
            return None
        try:
            return mount.app_for(slug, 'confirm')
        except KeyError:
            return None

    @app.route('/api/tasks/<task_id>/proposal', methods=['GET'])
    def get_task_proposal(task_id: str):
        """Read the AI-authored Stage-1 proposal through the mounted surface.

        The confirmation surface owns the recommendation files and the
        receipts, so this route proxies its JSON instead of keeping a second
        copy of the contract on the workbench side.
        """
        task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        runtime = _runtime_for(task_id)
        surface = _confirm_surface(task_id)
        if surface is None:
            resp = jsonify({
                'available': False,
                'reason': 'AI 还没有建立项目，建议生成后会出现在这里。',
            })
            resp.headers['Cache-Control'] = 'no-store'
            return resp
        project_dir_path = (
            Path(runtime['project_dir'])
            if runtime and runtime.get('project_dir')
            else None
        )
        outline_meta = outline_summary(project_dir_path) if project_dir_path is not None else None
        outline_sample = extract_outline_preview_sample(project_dir_path) if project_dir_path is not None else None
        saved_prefs = get_workbench_stage1_prefs(project_dir_path) if project_dir_path is not None else {}
        stage1_done = False
        if project_dir_path is not None:
            try:
                res_obj = _read_json_object(project_dir_path / 'confirm_ui' / 'result.json', retries=0)
                stage1_done = res_obj.get('stage') in {'stage1', 'final'}
            except (OSError, json.JSONDecodeError, ValueError):
                stage1_done = False
        with surface.test_client() as client:
            response = client.get('/api/recommendations')
            data = response.get_json(silent=True) or {}
        resp = jsonify(
            _proposal_payload(
                task,
                data,
                response.status_code,
                outline=outline_meta,
                outline_preview=outline_sample,
                preferred_visual_style=saved_prefs.get('preferred_visual_style'),
                stage1_confirmed=stage1_done,
                delegate_stage2=bool(saved_prefs.get('skip_stage2_review')),
            )
        )
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/tasks/<task_id>/proposal/reopen', methods=['POST'])
    def reopen_task_proposal(task_id: str):
        """Re-open Stage-1 style/template selection before slide generation starts."""
        _task, _task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        project_path, _runtime, proj_error = _project_or_abort(task_id)
        if proj_error:
            return proj_error
        if _file_listing(project_path / 'svg_output', _SLIDE_NAME_RE):
            return jsonify({'error': '幻灯片已开始生成，无法重置模板选择'}), 409
        confirm_dir = project_path / 'confirm_ui'
        for fname in ('result.json', 'template_selection.json', 'recommendations.stage2.json', 'session.json'):
            try:
                (confirm_dir / fname).unlink(missing_ok=True)
            except OSError:
                pass
        return jsonify({'status': 'ok'})

    @app.route('/api/tasks/<task_id>/confirm', methods=['POST'])
    def confirm_task(task_id: str):
        """Submit the one confirmation through the surface that owns it.

        The workbench never writes `result.json` itself: it builds the same
        Stage-1 payload the confirmation page sends and lets the mounted
        surface persist it.
        """
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if task.get('example_id'):
            return jsonify(error='此任务在大纲确认时使用已选示例'), 409
        runtime = _runtime_for(task_id)
        surface = _confirm_surface(task_id)
        if surface is None:
            return jsonify({'error': 'task has no project yet'}), 409
        request_body = request.get_json(silent=True)
        if not isinstance(request_body, dict):
            return jsonify({'error': 'payload must be a JSON object'}), 400
        skip_stage2 = request_body.get('skip_stage2_review', False)
        if skip_stage2 is not None and not isinstance(skip_stage2, bool):
            return jsonify({'error': 'skip_stage2_review must be a boolean'}), 400
        raw_style = request_body.get('preferred_visual_style')
        if raw_style is not None and not isinstance(raw_style, str):
            return jsonify({'error': 'preferred_visual_style must be a string or null'}), 400
        cleaned_style = raw_style.strip() if isinstance(raw_style, str) and raw_style.strip() else None
        if cleaned_style is not None:
            allowed_styles = valid_visual_style_ids()
            if allowed_styles and cleaned_style not in allowed_styles:
                return jsonify({'error': f'unknown preferred_visual_style: {cleaned_style}'}), 400
        payload, payload_error = _stage1_confirm_payload(task, request_body)
        if payload_error:
            return jsonify({'error': payload_error}), 400
        has_structural_template = any(
            k.startswith(('library:deck:', 'library:layout:', 'explicit:'))
            for k in payload['template_selection']['selection_keys']
        )
        resolved_style = None if has_structural_template else cleaned_style
        project_path = (
            Path(runtime['project_dir'])
            if runtime and runtime.get('project_dir')
            else None
        )
        outline_view = read_outline_view(project_path) if project_path is not None else None
        if outline_view and outline_view.get('available'):
            if not payload.get('core_message') and outline_view.get('title'):
                payload['core_message'] = str(outline_view['title'])[:_PROSE_MAX_CHARS]
            if not payload.get('audience') and outline_view.get('summary'):
                payload['audience'] = str(outline_view['summary'])[:_PROSE_MAX_CHARS]
        title = request_body.get('display_title')
        if title is not None and not isinstance(title, str):
            return jsonify({'error': 'display_title must be a string'}), 400
        if isinstance(title, str) and len(title.strip()) > 200:
            return jsonify({'error': 'display_title must be at most 200 characters'}), 400
        with surface.test_client() as client:
            response = client.post('/api/confirm', json=payload)
            body = response.get_json(silent=True) or {}
        if response.status_code == 200:
            if project_path is not None:
                set_workbench_stage1_prefs(
                    project_path,
                    skip_stage2_review=bool(skip_stage2),
                    preferred_visual_style=resolved_style,
                )
            body['delegate_stage2'] = bool(skip_stage2)
            body['preferred_visual_style'] = resolved_style
            effective_title = title
            if not (isinstance(effective_title, str) and effective_title.strip()) and outline_view:
                effective_title = outline_view.get('title') or None
            title_error = _rename_task(task, task_dir, effective_title)
            if title_error:
                return jsonify({'error': title_error}), 400
        return jsonify(body), response.status_code

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
        write_json_atomic(task_dir / FEEDBACK_FILE_NAME, {
            'schema_version': 1,
            'rating': rating,
            'comment': comment if comment is not None else '',
            'wants_revision': bool(wants_revision),
            'submitted_at': _now_iso(),
        })
        return jsonify({'status': 'ok'})

    # ---- agent-facing run surface: read state, answer a request -----------

    def _answer(project_path: Path, req_id: str):
        """Write the one allowed answer for an inbox request."""
        if _REQUEST_ID_RE.fullmatch(req_id) is None:
            return jsonify({'error': 'invalid request id'}), 404
        payload = request.get_json(silent=True) or {}
        status = str(payload.get('status') or 'answered')
        choice = payload.get('choice') or []
        if isinstance(choice, str):
            choice = [choice]
        try:
            response = agent_bridge.answer_request(
                project_path,
                req_id,
                status=status,
                choice=[str(item) for item in choice],
                text=payload.get('text'),
                by='user',
                surface='web',
            )
        except agent_bridge.BridgeError as exc:
            code = 409 if exc.code == agent_bridge.EXIT_VERSION_CONFLICT else 400
            return jsonify({'error': str(exc)}), code
        return jsonify({'response': response})

    @app.route('/api/projects', methods=['GET'])
    def list_projects():
        """One row per project, derived from its runtime directory."""
        rows = []
        for entry in _list_project_views(projects_path):
            view = entry['view']
            rows.append({
                'slug': entry['slug'],
                'project_dir': entry['project_dir'],
                'task_id': view.get('task_id'),
                'state': view.get('state'),
                'stage': view.get('stage'),
                'stage_index': view.get('stage_index'),
                'stage_label': view.get('stage_label'),
                'progress': view.get('progress'),
                'route': view.get('route'),
                'profile': view.get('profile'),
                'blocking': view.get('blocking'),
                'error': view.get('error'),
                'run_id': (view.get('run') or {}).get('run_id'),
                'updated_at': view.get('updated_at'),
                'lease_expires_at': view.get('lease_expires_at'),
            })
        resp = jsonify({'projects': rows})
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.get('/api/projects/<slug>/page-previews')
    def get_page_previews(slug: str):
        project, error = _resolve_project_path(projects_path, slug)
        if error:
            return error
        result = previews.view(project, _previewable_slides(project), _file_listing(project / 'exports', _EXPORT_NAME_RE))
        return jsonify(result), {'Cache-Control': 'no-store'}

    @app.get('/api/projects/<slug>/page-previews/<key>/<name>')
    def get_page_preview_image(slug: str, key: str, name: str):
        project, error = _resolve_project_path(projects_path, slug)
        if error:
            return error
        if not re.fullmatch(r'[0-9a-f]{64}', key) or not re.fullmatch(r'[1-9][0-9]*(?:-sm)?\.webp', name):
            return jsonify(error='unknown preview'), 404
        return send_from_directory(previews.cache / project.name / key, name, max_age=31536000)

    @app.route('/api/projects/<slug>', methods=['GET'])
    def get_project(slug: str):
        """Return one project's run view, recent events, and inbox."""
        project_path, error = _resolve_project_path(projects_path, slug)
        if error:
            return error
        view = agent_bridge.effective_state(agent_bridge.Paths(project_path))
        resp = jsonify({
            'slug': slug,
            'project_dir': str(project_path),
            'status': view,
            'events': agent_bridge.recent_events(project_path),
            'requests': agent_bridge.list_requests(project_path),
        })
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.route('/api/projects/<slug>/requests/<req_id>', methods=['POST'])
    def answer_project_request(slug: str, req_id: str):
        """Answer one inbox request addressed by project slug."""
        project_path, error = _resolve_project_path(projects_path, slug)
        if error:
            return error
        return _answer(project_path, req_id)

    # One service, one port: the per-project confirmation, preview, and spec

    # ---------- agent presence and dispatch ----------
    #
    # Agents are separate processes. They register, heartbeat, and ask whether a
    # task was dispatched to them; the page never guesses which AI is available.

    @app.route('/api/agents', methods=['GET'])
    def list_agent_presence():
        agents = _list_agents(projects_path)
        background = codex_agent()
        if background:
            agents.append(background)
        return jsonify({'agents': agents})

    @app.route('/api/agents/register', methods=['POST'])
    def register_agent():
        data = request.get_json(silent=True) or {}
        name = str(data.get('name') or '').strip()[:80]
        agent_id = 'a-' + secrets.token_hex(4)
        record = {
            'agent_id': agent_id,
            'name': name or ('AI ' + agent_id[-4:]),
            'host': str(data.get('host') or '')[:120],
            'pid': data.get('pid'),
            'created_at': _now_iso(),
            'last_seen': _now_iso(),
        }
        _agents_dir(projects_path).mkdir(parents=True, exist_ok=True)
        write_json_atomic(_agents_dir(projects_path) / f'{agent_id}.json', record)
        return jsonify(record), 201

    @app.route('/api/agents/<agent_id>/heartbeat', methods=['POST'])
    def heartbeat_agent(agent_id: str):
        path = _agents_dir(projects_path) / f'{agent_id}.json'
        if not path.is_file():
            return jsonify({'error': 'unknown agent'}), 404
        record = _read_json_object(path)
        record['last_seen'] = _now_iso()
        write_json_atomic(path, record)
        return jsonify({'agent_id': agent_id, 'last_seen': record['last_seen']})

    @app.delete('/api/agents/<agent_id>')
    def disconnect_agent(agent_id: str):
        if not re.fullmatch(r'a-[0-9a-f]{8}', agent_id):
            return jsonify(error='unknown agent'), 404
        (_agents_dir(projects_path) / f'{agent_id}.json').unlink(missing_ok=True)
        return '', 204

    @app.route('/api/agents/<agent_id>/assignment', methods=['GET'])
    def agent_assignment(agent_id: str):
        path = _agents_dir(projects_path) / f'{agent_id}.json'
        if not path.is_file():
            return ('', 404)
        record = _read_json_object(path)
        record['last_seen'] = _now_iso()
        write_json_atomic(path, record)
        for item in sorted(_assignments_dir(projects_path).glob('*.json')):
            assignment = _assignment_for(projects_path, item.stem)
            if not assignment or assignment.get('agent_id') != agent_id:
                continue
            task_file = _task_file_path(projects_path, item.stem)
            task = _read_json_object(task_file)
            return jsonify({
                'assignment': assignment,
                'task': {
                    'task_id': item.stem,
                    'topic': task.get('topic'),
                    'display_title': task.get('display_title'),
                    'task_file': str(task_file),
                },
            })
        return ('', 204)

    @app.route('/api/tasks/<task_id>/assign', methods=['POST'])
    def assign_task(task_id: str):
        with dispatch_lock:
            return dispatch_task(task_id)

    def dispatch_task(task_id: str, agent_id: str = ''):
        task, task_dir, error = _load_task_or_abort(task_id)
        if error:
            return error
        if not task.get('submitted_at'):
            return jsonify({'error': 'only submitted tasks can be dispatched'}), 409
        data = request.get_json(silent=True) or {}
        agent_id = agent_id or str(data.get('agent_id') or '')
        existing = _assignment_for(projects_path, task_id)
        managed = agent_id == codex_dispatch.AGENT_ID
        if existing and existing.get('phase') == 'accepted':
            if existing['agent_id'] == agent_id:
                return jsonify(assignment=existing)
            return jsonify(error='已有 AI 正在处理此任务'), 409
        retry = managed and existing and existing.get('phase') == 'stopped' and data.get('retry') is True
        runtime = _runtime_for(task_id)
        if runtime and (not retry or _derived_state(task, runtime) == 'done'):
            return jsonify({'error': 'task already has a run'}), 409
        if existing and existing.get('agent_id') != agent_id and not retry:
            return jsonify({'error': 'already dispatched to ' + str(existing.get('name'))}), 409
        if managed:
            if not request.is_json or request.headers.get('Origin', request.host_url.rstrip('/')) != request.host_url.rstrip('/'):
                return jsonify(error='请在本地工作台分派任务'), 403
            agent = codex_agent()
            if not agent:
                return jsonify(error='Codex 后台执行器未连接'), 409
            if existing and existing.get('phase') == 'stopped' and not retry:
                return jsonify(assignment=existing)
            attempt = secrets.token_hex(6)
            assignment = {'task_id': task_id, 'agent_id': agent_id, 'name': agent['name'], 'attempt': attempt,
                          'created_at': _now_iso(), 'phase': 'stopped'}
            path = _assignments_dir(projects_path) / f'{task_id}.json'
            write_json_atomic(path, assignment)
            log_path = runtime_dir / 'jobs' / task_id / (attempt + '.log')
            prompt = AGENT_HINT_TEMPLATE.format(task_id=task_id, repo_root=_repo_root(projects_path),
                                               base_url=_server_url(server_port or DEFAULT_PORT))
            prompt += '\n请在本次后台执行中持续等待网页确认，按流程完成交付。'
            try:
                proc = codex_dispatch.launch(codex_cli, _repo_root(projects_path), log_path, prompt)
            except OSError:
                logger.exception('cannot launch Codex for %s', task_id)
                return jsonify(error='Codex 启动失败，请检查本机 CLI 后重试'), 503
            assignment.update(phase='accepted', pid=proc.pid)
            write_json_atomic(path, assignment)

            def record_exit():
                code = proc.wait()
                with dispatch_lock:
                    latest = _assignment_for(projects_path, task_id)
                    if latest and latest.get('attempt') == attempt:
                        write_json_atomic(path, {**latest, 'phase': 'stopped', 'exit_code': code})

            threading.Thread(target=record_exit, daemon=True).start()
            return jsonify(assignment=assignment)
        if not re.fullmatch(r'a-[0-9a-f]{8}', agent_id):
            return jsonify(error='unknown agent'), 404
        agent_path = _agents_dir(projects_path) / f'{agent_id}.json'
        if not agent_id or not agent_path.is_file():
            return jsonify({'error': 'unknown agent'}), 404
        agent = _read_json_object(agent_path)
        if not _agent_online(agent):
            return jsonify({'error': 'agent is offline'}), 409
        _assignments_dir(projects_path).mkdir(parents=True, exist_ok=True)
        assignment = {
            'task_id': task_id,
            'agent_id': agent_id,
            'name': agent.get('name'),
            'created_at': _now_iso(),
            'expires_at': _iso_after(ASSIGNMENT_TTL_SECONDS),
        }
        write_json_atomic(_assignments_dir(projects_path) / f'{task_id}.json', assignment)
        return jsonify({'assignment': assignment})

    @app.route('/api/tasks/<task_id>/assign', methods=['DELETE'])
    def unassign_task(task_id: str):
        _, _, error = _load_task_or_abort(task_id)
        if error:
            return error
        with dispatch_lock:
            assignment = _assignment_for(projects_path, task_id)
            if assignment and assignment.get('phase') == 'accepted':
                return jsonify(error='执行已开始'), 409
            return jsonify({'cleared': _clear_assignment(projects_path, task_id)})

    def _resolve_task_id_for_slug(slug: str) -> Optional[str]:
        project_dir, error = _resolve_project_path(projects_path, slug)
        if error:
            return None
        try:
            view = agent_bridge.effective_state(agent_bridge.Paths(project_dir))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        task_id = view.get('task_id')
        if not task_id or TASK_ID_RE.fullmatch(str(task_id)) is None:
            return None
        if not (_task_dir_path(projects_path, str(task_id)) / TASK_FILE_NAME).is_file():
            return None
        return str(task_id)

    # APIs for confirm and preview stay mounted here instead of running own servers.
    mount_surfaces(app, projects_path, task_id_resolver=_resolve_task_id_for_slug)

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
    parser.add_argument('--service-only', action='store_true', help='Serve without attaching the calling AI session')
    parser.add_argument(
        '--daemon', action='store_true',
        help='Start the web server in the background (use --service-only to skip AI attach)',
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

    agent_name = '' if args.service_only else workbench_agent.session_environment()
    if args.daemon or agent_name:
        existing = _read_lock(lock_file)
        if existing and _process_alive(_lock_pid(existing)):
            port = int(existing.get('port') or DEFAULT_PORT)
            if agent_name and args.port in (None, port):
                url = _server_url(port)
                logger.info('attaching %s to the existing workbench at %s', agent_name, url)
                return workbench_agent.attach(url, agent_name)
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
        return workbench_agent.attach(_server_url(port), agent_name) if agent_name else 0

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
