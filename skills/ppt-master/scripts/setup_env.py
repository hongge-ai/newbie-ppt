#!/usr/bin/env python3
"""newbie-ppt - One-click Environment Setup

Bootstrap uv (if missing), sync layered dependencies, and verify imports.

Usage:
    python skills/ppt-master/scripts/setup_env.py                     # full: core + all groups
    python skills/ppt-master/scripts/setup_env.py --core              # core only
    python skills/ppt-master/scripts/setup_env.py --group pdf,web     # core + selected groups
    python skills/ppt-master/scripts/setup_env.py --list-groups       # show groups and exit

Dependency layers live in the root pyproject.toml ([project.dependencies]
for core, [dependency-groups] for optional capability). The Tsinghua PyPI
mirror is pinned there as the default index, so uv needs no extra flags.
(Overriding the index rewrites uv.lock; if you must, run
`uv sync --default-index <url>` manually.)

Dependencies:
    None (standard library only)
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from console_encoding import configure_utf8_stdio

configure_utf8_stdio()


TOOLS_DIR = Path(__file__).resolve().parent
SKILL_DIR = TOOLS_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent

CORE = "core"
GROUP_DESCRIPTIONS: dict[str, str] = {
    "pdf": "PDF source import / PDF 源导入 (AGPL: PyMuPDF)",
    "web": "Web page import incl. WeChat / 网页导入（含微信文章）",
    "office": "Office/iPython import + chart workbooks / 文档导入与图表工作簿",
    "media": "Narration audio + timing tools / 旁白音频与计时工具",
    "ai-image": "Gemini AI image backend / Gemini AI 图像后端",
}
ALL_GROUPS: tuple[str, ...] = ("core",) + tuple(GROUP_DESCRIPTIONS)

# Import names used by the post-sync verification pass.
GROUP_IMPORTS: dict[str, tuple[str, ...]] = {
    "core": ("yaml", "pptx", "pathops", "uharfbuzz", "PIL", "flask", "requests"),
    "pdf": ("fitz",),
    "web": ("bs4", "curl_cffi"),
    "office": ("mammoth", "markdownify", "ebooklib", "nbconvert", "openpyxl", "xlsxwriter"),
    "media": ("edge_tts", "numpy"),
    "ai-image": ("google.genai",),
}

# Index used only for the pip bootstrap fallback (uv itself reads the
# pyproject-pinned Tsinghua mirror).
TSINGHUA_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"

AGPL_NOTICE = """\
License notice / 许可证说明
  The optional `pdf` group installs PyMuPDF, which is AGPL-3.0 (a commercial
  license is available from Artifex). It is imported only by
  source_to_md/pdf_to_md.py. Run with --core to avoid it entirely, and review
  the AGPL terms before redistributing a bundle that includes it.
  可选组 `pdf` 会安装 AGPL-3.0 的 PyMuPDF（Artifex 另提供商业许可），仅
  source_to_md/pdf_to_md.py 导入。用 --core 可完全避开；若要连同依赖一起
  再分发，请先核对 AGPL 条款（详见 scripts/docs/conversion.md）。"""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "One-click environment setup: bootstrap uv, sync layered "
            "dependencies from the root pyproject.toml, verify imports."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument(
        "--core",
        action="store_true",
        help="Install only the core dependencies (skip every optional group).",
    )
    scope.add_argument(
        "--group",
        metavar="LIST",
        help=(
            "Comma-separated optional groups to add on top of core "
            f"(choices: {', '.join(GROUP_DESCRIPTIONS)})."
        ),
    )
    parser.add_argument(
        "--list-groups",
        action="store_true",
        help="List dependency groups with descriptions and exit.",
    )
    return parser.parse_args(argv)


def resolve_selection(args: argparse.Namespace) -> tuple[str, list[str]]:
    """Return (mode, groups) where mode is 'all' | 'core' | 'selective'.

    `groups` names every layer that will be present after the sync (used for
    import verification and the AGPL notice).
    """
    if args.core:
        return "core", [CORE]
    if args.group:
        requested = [name.strip() for name in args.group.split(",") if name.strip()]
        invalid = [name for name in requested if name not in GROUP_DESCRIPTIONS]
        if invalid:
            raise SystemExit(
                f"Unknown group(s): {', '.join(invalid)}. "
                f"Valid groups: {', '.join(GROUP_DESCRIPTIONS)}."
            )
        if not requested:
            raise SystemExit("--group needs at least one group name.")
        return "selective", [CORE, *requested]
    return "all", list(ALL_GROUPS)


def sync_args(mode: str, groups: list[str]) -> list[str]:
    args: list[str] = []
    if mode == "all":
        args.append("--all-groups")
    elif mode == "selective":
        for group in groups:
            if group != CORE:
                args += ["--group", group]
    return args


def agpl_needed(groups: list[str]) -> bool:
    return "pdf" in groups


def uv_search_paths() -> list[Path]:
    paths: list[Path] = [Path.home() / ".local" / "bin"]
    if platform.system() == "Windows":
        local_appdata = os.environ.get("LOCALAPPDATA")
        if local_appdata:
            paths.append(Path(local_appdata) / "Microsoft" / "WinGet" / "Links")
    return paths


def find_uv() -> str | None:
    found = shutil.which("uv")
    if found:
        return found
    for directory in uv_search_paths():
        candidate = directory / ("uv.exe" if platform.system() == "Windows" else "uv")
        if candidate.is_file():
            return str(candidate)
    return None


def run(command: list[str]) -> int:
    print(f"  $ {' '.join(command)}")
    return subprocess.run(command, cwd=REPO_ROOT).returncode


def _pip_index() -> list[str]:
    return ["-i", TSINGHUA_INDEX]


def bootstrap_uv() -> str | None:
    """Install uv with the platform's package channel; return its path or None."""
    system = platform.system()
    if system == "Windows":
        winget = shutil.which("winget")
        if winget:
            print("Installing uv with winget / 使用 winget 安装 uv ...")
            if run([winget, "install", "--id=astral-sh.uv", "-e",
                    "--accept-source-agreements", "--accept-package-agreements"]) == 0:
                found = find_uv()
                if found:
                    return found
    else:
        curl = shutil.which("curl")
        sh = shutil.which("sh")
        if curl and sh:
            print("Installing uv with the official installer / 使用官方安装脚本 ...")
            completed = subprocess.run(
                [f"{curl} -LsSf https://astral.sh/uv/install.sh | {sh}"],
                cwd=REPO_ROOT,
                shell=True,
                executable=sh,
            )
            if completed.returncode == 0:
                found = find_uv()
                if found:
                    return found

    # Last resort: the current interpreter's pip (Tsinghua mirror).
    print("Trying to install uv with pip / 尝试用 pip 安装 uv ...")
    if run([sys.executable, "-m", "pip", "install", "--upgrade", "uv", *_pip_index()]) == 0:
        scripts_dir = Path(sys.executable).parent
        candidate = scripts_dir / ("uv.exe" if system == "Windows" else "uv")
        if candidate.is_file():
            return str(candidate)
        found = find_uv()
        if found:
            return found
    return None


UV_MANUAL_HINT = """\
Install uv manually, then re-run this script / 请手动安装 uv 后重跑本脚本:
  Windows:  winget install astral-sh.uv     (or https://docs.astral.sh/uv/getting-started/install/)
  macOS:    brew install uv                 (or curl -LsSf https://astral.sh/uv/install.sh | sh)
  Linux:    curl -LsSf https://astral.sh/uv/install.sh | sh"""


def verify_imports(uv: str, groups: list[str]) -> bool:
    print("\nVerifying imports / 校验依赖导入 ...")
    all_ok = True
    for group in groups:
        modules = ", ".join(GROUP_IMPORTS[group])
        code = f"import {modules}"
        result = subprocess.run(
            [uv, "run", "--no-sync", "python", "-c", code],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode == 0:
            print(f"  [ok] {group}")
        else:
            all_ok = False
            detail = (result.stderr or result.stdout or "").strip().splitlines()
            print(f"  [FAIL] {group}: {detail[-1] if detail else 'import failed'}")
    return all_ok


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if args.list_groups:
        print("Dependency groups / 依赖分组 (pyproject.toml):")
        print(f"  core  — main workflow: workbench -> generation -> PPTX export / 主链路")
        for name, description in GROUP_DESCRIPTIONS.items():
            print(f"  {name:<8} — {description}")
        return 0

    mode, groups = resolve_selection(args)

    uv = find_uv()
    if uv is None:
        print("uv not found / 未检测到 uv")
        uv = bootstrap_uv()
    if uv is None:
        print(UV_MANUAL_HINT)
        return 1
    print(f"uv: {uv}")

    if agpl_needed(groups):
        print()
        print(AGPL_NOTICE)

    scope = "core + all optional groups / 核心 + 全部可选组"
    if mode == "core":
        scope = "core only / 仅核心"
    elif mode == "selective":
        optional = [group for group in groups if group != CORE]
        scope = f"core + {', '.join(optional)}"
    print(f"\nSyncing dependencies ({scope}) / 同步依赖 ...")

    # --inexact: additive installer semantics — never prune groups the user
    # installed on an earlier run. Re-run with `uv sync` directly to prune.
    command = [uv, "sync", "--inexact", *sync_args(mode, groups)]
    if run(command) != 0:
        print("Dependency sync failed / 依赖同步失败。", file=sys.stderr)
        return 1

    ok = verify_imports(uv, groups)

    print("\nNext steps / 下一步:")
    print("  uv run python skills/ppt-master/scripts/workbench/server.py   # open the workbench / 打开工作台")
    print("  uv run python skills/ppt-master/scripts/update_repo.py        # update repo + deps / 更新仓库与依赖")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
