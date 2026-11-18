#!/usr/bin/env python3
"""
PPT Master - Outline Review Store

Persist and coordinate the Step-1 slide outline (``<project>/outline.md``) and
its multi-round review/finalization state (``<project>/confirm_ui/outline_state.json``)
between the local workbench browser and the executing AI agent.

Usage:
    python3 scripts/confirm_ui/outline_store.py <project_path> [--publish]

Examples:
    python3 scripts/confirm_ui/outline_store.py projects/demo_ppt169_20261118 --publish
    python3 scripts/confirm_ui/outline_store.py projects/demo_ppt169_20261118

Dependencies:
    None (only uses standard library)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from atomic_io import write_bytes_atomic, write_json_atomic  # noqa: E402
from console_encoding import configure_utf8_stdio  # noqa: E402

CONFIRM_DIR_NAME = "confirm_ui"
OUTLINE_FILE_NAME = "outline.md"
OUTLINE_STATE_NAME = "outline_state.json"
WORKBENCH_PREFS_NAME = "workbench_prefs.json"

OUTLINE_SCHEMA_VERSION = 1
PREFS_SCHEMA_VERSION = 1
MAX_OUTLINE_CHARS = 200_000
MAX_COMMENTS = 200
MAX_COMMENT_FIELD = 2000
MAX_TITLE_CHARS = 200

_STRIP_TAG_RE = re.compile(
    r"<(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?</\1\s*>"
    r"|<(script|style|iframe|object|embed|link|meta)\b[^>]*/?>",
    re.IGNORECASE,
)
_ON_EVENT_RE = re.compile(r"""\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.IGNORECASE)
_JS_PROTO_RE = re.compile(r"javascript\s*:", re.IGNORECASE)
_FENCE_RE = re.compile(r"^```")


class OutlineConflictError(ValueError):
    """Raised when an outline transition conflicts with the active state (HTTP 409)."""


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _strip_reasoning(text: str) -> str:
    lower = text.lower()
    last_close = lower.rfind("</think>")
    if last_close >= 0:
        text = text[last_close + len("</think>"):]
    else:
        text = re.sub(r"<think>[\s\S]*$", "", text, flags=re.IGNORECASE)
    return re.sub(r"</?think>", "", text, flags=re.IGNORECASE).strip()


def sanitize_outline_markdown(raw: object) -> str:
    """Clean untrusted Markdown outline text while keeping formatting intact."""
    if not isinstance(raw, str):
        raise ValueError("outline markdown must be a string")
    cleaned = _strip_reasoning(raw)
    cleaned = _STRIP_TAG_RE.sub("", cleaned)
    cleaned = _ON_EVENT_RE.sub("", cleaned)
    cleaned = _JS_PROTO_RE.sub("", cleaned)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(cleaned) > MAX_OUTLINE_CHARS:
        raise ValueError(f"outline markdown exceeds {MAX_OUTLINE_CHARS} characters")
    return (cleaned + "\n") if cleaned else ""


def _plain_text_for_quote(md: str) -> str:
    """Approximate browser selection text by stripping inline/block Markdown markers."""
    text = re.sub(r"```[\s\S]*?```", " ", md)
    text = re.sub(r"^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    text = re.sub(r"(\*|_)(.*?)\1", r"\2", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_outline_metadata(markdown: str) -> dict:
    """Extract deck title, top positioning summary, and slide count from outline Markdown."""
    title = ""
    summary_lines: list[str] = []
    slide_count = 0
    in_fence = False
    seen_slide = False

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or not line:
            continue
        if not title and line.startswith("# ") and not line.startswith("## "):
            title = line[2:].strip()[:MAX_TITLE_CHARS]
            continue
        if line.startswith("## ") and not line.startswith("### "):
            seen_slide = True
            slide_count += 1
            continue
        if not seen_slide and line.startswith(">"):
            note = line.lstrip(">").strip()
            if note:
                summary_lines.append(note)

    return {
        "title": title,
        "summary": " ".join(summary_lines).strip(),
        "slide_count": slide_count,
    }


def outline_paths(project_path: Path) -> tuple[Path, Path]:
    """Return ``(outline_md_path, outline_state_json_path)``."""
    return (
        project_path / OUTLINE_FILE_NAME,
        project_path / CONFIRM_DIR_NAME / OUTLINE_STATE_NAME,
    )


def _read_state_file(state_path: Path) -> Optional[dict]:
    if not state_path.is_file():
        return None
    try:
        data = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def read_outline_view(project_path: Path) -> dict:
    """Return the complete browser/CLI view of a project's outline and review state."""
    md_path, state_path = outline_paths(project_path)
    state = _read_state_file(state_path)
    if not md_path.is_file():
        status = (state or {}).get("status") if state else "missing"
        return {
            "available": False,
            "status": status if status in {"revising", "missing"} else "missing",
            "round": int((state or {}).get("round") or 0),
            "title": "",
            "summary": "",
            "slide_count": 0,
            "markdown": "",
            "outline_sha256": None,
            "pending_revision": (state or {}).get("pending_revision"),
            "confirmed_at": None,
            "updated_at": (state or {}).get("updated_at"),
        }

    markdown = md_path.read_text(encoding="utf-8")
    sha = _sha256_text(markdown)
    meta = extract_outline_metadata(markdown)
    status = str((state or {}).get("status") or "ready")
    if status not in {"ready", "revising", "confirmed"}:
        status = "ready"
    round_no = max(1, int((state or {}).get("round") or 1))
    return {
        "available": True,
        "status": status,
        "round": round_no,
        "title": meta["title"],
        "summary": meta["summary"],
        "slide_count": meta["slide_count"],
        "markdown": markdown,
        "outline_sha256": sha,
        "pending_revision": (state or {}).get("pending_revision") if status == "revising" else None,
        "confirmed_at": (state or {}).get("confirmed_at") if status == "confirmed" else None,
        "updated_at": (state or {}).get("updated_at"),
    }


def outline_summary(project_path: Path) -> dict:
    """Compact summary embedded in task progress responses."""
    view = read_outline_view(project_path)
    return {
        "exists": view["available"],
        "status": view["status"],
        "round": view["round"],
        "title": view["title"],
        "slide_count": view["slide_count"],
    }


def publish_outline(project_path: Path, markdown: Optional[str] = None) -> dict:
    """Publish a draft or revised outline from the agent and mark it ``ready``."""
    md_path, state_path = outline_paths(project_path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    if markdown is not None:
        cleaned = sanitize_outline_markdown(markdown)
        if not cleaned:
            raise ValueError("outline markdown cannot be empty")
        write_bytes_atomic(md_path, cleaned.encode("utf-8"))
    elif not md_path.is_file():
        raise ValueError(f"{OUTLINE_FILE_NAME} does not exist in {project_path}")
    else:
        cleaned = sanitize_outline_markdown(md_path.read_text(encoding="utf-8"))
        if not cleaned:
            raise ValueError("outline markdown cannot be empty")
        write_bytes_atomic(md_path, cleaned.encode("utf-8"))

    sha = _sha256_text(cleaned)
    prev = _read_state_file(state_path) or {}
    prev_round = int(prev.get("round") or 0)
    prev_status = prev.get("status")
    prev_sha = prev.get("outline_sha256")
    if prev_round == 0:
        next_round = 1
    elif prev_status == "revising" or prev_sha != sha:
        next_round = prev_round + 1
    else:
        next_round = prev_round

    now = _now_iso()
    record = {
        "schema_version": OUTLINE_SCHEMA_VERSION,
        "status": "ready",
        "round": next_round,
        "outline_sha256": sha,
        "pending_revision": None,
        "confirmed_at": None,
        "updated_at": now,
    }
    write_json_atomic(state_path, record)
    return read_outline_view(project_path)


def save_user_outline(project_path: Path, markdown: object) -> dict:
    """Persist direct user edits to ``outline.md`` from the workbench page."""
    md_path, state_path = outline_paths(project_path)
    prev = _read_state_file(state_path) or {}
    if prev.get("status") == "revising":
        raise OutlineConflictError("AI 正在根据批注修改大纲，请等待本轮修改完成后再编辑")
    cleaned = sanitize_outline_markdown(markdown)
    if not cleaned:
        raise ValueError("大纲内容不能为空")
    meta = extract_outline_metadata(cleaned)
    if meta["slide_count"] < 1:
        raise ValueError("大纲至少需要保留 1 页（二级标题 ## ）")

    state_path.parent.mkdir(parents=True, exist_ok=True)
    write_bytes_atomic(md_path, cleaned.encode("utf-8"))
    sha = _sha256_text(cleaned)
    keep_confirmed = prev.get("status") == "confirmed"
    now = _now_iso()
    record = {
        "schema_version": OUTLINE_SCHEMA_VERSION,
        "status": "confirmed" if keep_confirmed else "ready",
        "round": max(1, int(prev.get("round") or 1)),
        "outline_sha256": sha,
        "pending_revision": None,
        "confirmed_at": prev.get("confirmed_at") if keep_confirmed else None,
        "updated_at": now,
    }
    write_json_atomic(state_path, record)
    return read_outline_view(project_path)


def normalize_outline_comments(raw_comments: object, markdown: str) -> list[dict]:
    """Validate and normalize highlight comments against the current outline."""
    if raw_comments is None:
        return []
    if not isinstance(raw_comments, list):
        raise ValueError("comments must be a list")
    doc_plain = _plain_text_for_quote(markdown)
    cleaned: list[dict] = []
    for index, item in enumerate(raw_comments[:MAX_COMMENTS]):
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote") or "").strip()[:MAX_COMMENT_FIELD]
        comment = str(item.get("comment") or "").strip()[:MAX_COMMENT_FIELD]
        if not quote or not comment:
            continue
        quote_plain = _plain_text_for_quote(quote)
        if markdown and quote not in markdown and (not quote_plain or quote_plain not in doc_plain):
            continue
        slide_no = item.get("slide")
        slide = int(slide_no) if isinstance(slide_no, int) and not isinstance(slide_no, bool) and slide_no >= 1 else None
        slide_title = str(item.get("slide_title") or "").strip()[:MAX_TITLE_CHARS]
        cleaned.append({
            "id": str(item.get("id") or f"c_{index + 1}")[:40],
            "slide": slide,
            "slide_title": slide_title,
            "quote": quote,
            "comment": comment,
        })
    return cleaned


def submit_outline_revision(
    project_path: Path,
    comments: object,
    global_note: object = "",
    markdown: Optional[str] = None,
) -> dict:
    """Queue a batch of inline comments / global instructions for the agent to revise."""
    md_path, state_path = outline_paths(project_path)
    prev = _read_state_file(state_path) or {}
    if prev.get("status") == "revising":
        raise OutlineConflictError("已有批注正在等待 AI 修改，请稍候")
    if markdown is not None:
        save_user_outline(project_path, markdown)
    if not md_path.is_file():
        raise ValueError("当前还没有可修改的大纲")
    current_md = md_path.read_text(encoding="utf-8")
    if global_note is not None and not isinstance(global_note, str):
        raise ValueError("global_note must be a string")
    note_text = (global_note or "").strip()[:MAX_COMMENT_FIELD]
    cleaned_comments = normalize_outline_comments(comments, current_md)
    if not cleaned_comments and not note_text:
        raise ValueError("请先在正文划词添加批注，或填写补充修改要求")

    sha = _sha256_text(current_md)
    now = _now_iso()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": OUTLINE_SCHEMA_VERSION,
        "status": "revising",
        "round": max(1, int(prev.get("round") or 1)),
        "outline_sha256": sha,
        "pending_revision": {
            "submitted_at": now,
            "base_sha256": sha,
            "comments": cleaned_comments,
            "global_note": note_text,
        },
        "confirmed_at": None,
        "updated_at": now,
    }
    write_json_atomic(state_path, record)
    return read_outline_view(project_path)


def confirm_outline(project_path: Path, markdown: Optional[str] = None) -> dict:
    """Freeze ``outline.md`` as the confirmed content baseline."""
    md_path, state_path = outline_paths(project_path)
    prev = _read_state_file(state_path) or {}
    if prev.get("status") == "revising":
        raise OutlineConflictError("AI 正在修改大纲，请等待修改完成后再定稿")
    if markdown is not None:
        save_user_outline(project_path, markdown)
    if not md_path.is_file():
        raise ValueError("当前还没有可确认的大纲")
    current_md = sanitize_outline_markdown(md_path.read_text(encoding="utf-8"))
    meta = extract_outline_metadata(current_md)
    if not current_md or meta["slide_count"] < 1:
        raise ValueError("大纲至少需要包含 1 页内容才能确认")
    write_bytes_atomic(md_path, current_md.encode("utf-8"))

    sha = _sha256_text(current_md)
    now = _now_iso()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "schema_version": OUTLINE_SCHEMA_VERSION,
        "status": "confirmed",
        "round": max(1, int(prev.get("round") or 1)),
        "outline_sha256": sha,
        "pending_revision": None,
        "confirmed_at": now,
        "updated_at": now,
    }
    write_json_atomic(state_path, record)
    return read_outline_view(project_path)


_CATALOGS_PATH = Path(__file__).resolve().parent / "static" / "catalogs.json"


def valid_visual_style_ids() -> set[str]:
    """Return all registered visual_style catalog IDs."""
    try:
        catalogs = json.loads(_CATALOGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    ids: set[str] = set()
    for group in catalogs.get("visual_styles") or []:
        if not isinstance(group, dict):
            continue
        for item in group.get("items") or []:
            if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]:
                ids.add(item["id"])
    return ids


def _clean_preview_line(line: str, limit: int = 44) -> str:
    text = re.sub(r"^\s*(?:[-*+]|\d+[.、])\s+", "", line.strip())
    text = re.sub(r"(\*\*|__)(.*?)\1", r"\2", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return (text[:limit - 1] + "…") if len(text) > limit else text


def extract_outline_preview_sample(project_path: Path) -> Optional[dict]:
    """Extract representative cover/chapter/content/data copy from outline.md for live style previews."""
    md_path, _state_path = outline_paths(project_path)
    if not md_path.is_file():
        return None
    markdown = md_path.read_text(encoding="utf-8")
    meta = extract_outline_metadata(markdown)
    sections: list[dict] = []
    current: Optional[dict] = None
    in_fence = False
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence or not line:
            continue
        if line.startswith("## ") and not line.startswith("### "):
            if current is not None:
                sections.append(current)
            rest = re.sub(
                r"^(?:第\s*\d+\s*页|P\d{1,3}|Slide\s*\d{1,3}|\d{1,2})\s*(?:[·:：.\-—]\s*)?",
                "",
                line[3:].strip(),
                flags=re.IGNORECASE,
            ).strip()
            role = ""
            role_match = re.match(r"^(?:\[([^\]]+)\]|【([^】]+)】)\s*", rest)
            if role_match:
                role = (role_match.group(1) or role_match.group(2) or "").strip()
                rest = rest[role_match.end():].strip()
            current = {"role": role, "title": _clean_preview_line(rest, 30), "bullets": []}
        elif current is not None and not line.startswith("#"):
            cleaned = _clean_preview_line(line.lstrip(">").strip(), 42)
            if cleaned and len(current["bullets"]) < 4:
                current["bullets"].append(cleaned)
    if current is not None:
        sections.append(current)
    if not sections:
        return None

    def _pick(roles: tuple[str, ...], fallback_idx: int) -> dict:
        for sec in sections:
            if sec["role"] in roles:
                return sec
        return sections[min(fallback_idx, len(sections) - 1)]

    cover = _pick(("封面",), 0)
    chapter = _pick(("章节", "目录"), 1)
    content = _pick(("正文",), 2)
    data = _pick(("数据", "总结"), min(3, len(sections) - 1))

    return {
        "cover_title": cover["title"] or _clean_preview_line(meta["title"], 30),
        "cover_sub": (cover["bullets"][0] if cover["bullets"] else _clean_preview_line(meta["summary"], 42)),
        "chapter_title": chapter["title"],
        "chapter_sub": (chapter["bullets"][0] if chapter["bullets"] else "核心问题拆解与关键事实展开"),
        "content_title": content["title"],
        "content_bullets": content["bullets"][:3],
        "data_title": data["title"],
        "data_bullets": data["bullets"][:3],
    }


def set_workbench_stage1_prefs(
    project_path: Path,
    *,
    skip_stage2_review: bool,
    preferred_visual_style: Optional[str] = None,
) -> None:
    """Persist Workbench Stage-1 user preferences (Stage-2 delegation & selected visual_style)."""
    if preferred_visual_style is not None:
        allowed = valid_visual_style_ids()
        if allowed and preferred_visual_style not in allowed:
            raise ValueError(f"unknown preferred_visual_style: {preferred_visual_style}")
    prefs_path = project_path / CONFIRM_DIR_NAME / WORKBENCH_PREFS_NAME
    prefs_path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(prefs_path, {
        "schema_version": PREFS_SCHEMA_VERSION,
        "skip_stage2_review": bool(skip_stage2_review),
        "preferred_visual_style": preferred_visual_style,
        "updated_at": _now_iso(),
    })


def get_workbench_stage1_prefs(project_path: Path) -> dict:
    """Return ``{skip_stage2_review, preferred_visual_style}`` recorded on Stage-1 confirm."""
    prefs_path = project_path / CONFIRM_DIR_NAME / WORKBENCH_PREFS_NAME
    data = _read_state_file(prefs_path) or {}
    raw_style = data.get("preferred_visual_style")
    allowed = valid_visual_style_ids()
    style = raw_style if isinstance(raw_style, str) and (not allowed or raw_style in allowed) else None
    return {
        "skip_stage2_review": bool(data.get("skip_stage2_review") is True),
        "preferred_visual_style": style,
    }


def set_stage2_delegation(project_path: Path, skip_stage2_review: bool) -> None:
    """Record whether the user chose direct generation (delegating Stage-2 defaults)."""
    existing = get_workbench_stage1_prefs(project_path)
    set_workbench_stage1_prefs(
        project_path,
        skip_stage2_review=skip_stage2_review,
        preferred_visual_style=existing["preferred_visual_style"],
    )


def get_stage2_delegation(project_path: Path) -> bool:
    """Return True when the user clicked direct generation on the template step."""
    return get_workbench_stage1_prefs(project_path)["skip_stage2_review"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Inspect or publish a project's outline.md review state.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project_path", help="Project directory")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Publish current outline.md as ready for user review",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)
    project = Path(args.project_path).expanduser().resolve()
    if not project.is_dir():
        print(f"error: not a directory: {project}", file=sys.stderr)
        return 1
    try:
        view = publish_outline(project) if args.publish else read_outline_view(project)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({
        "available": view["available"],
        "status": view["status"],
        "round": view["round"],
        "title": view["title"],
        "slide_count": view["slide_count"],
        "outline_sha256": view["outline_sha256"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
