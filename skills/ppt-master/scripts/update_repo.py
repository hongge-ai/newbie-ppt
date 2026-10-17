#!/usr/bin/env python3
"""PPT Master - Repository Updater

Pull the latest Git checkout and sync Python dependencies when the uv
dependency manifest (pyproject.toml + uv.lock) changes.

Usage:
    uv run python skills/ppt-master/scripts/update_repo.py
    uv run python skills/ppt-master/scripts/update_repo.py --skip-deps

Examples:
    uv run python skills/ppt-master/scripts/update_repo.py
    uv run python skills/ppt-master/scripts/update_repo.py --skip-deps

Dependencies:
    None (standard library only)
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

from console_encoding import configure_utf8_stdio

configure_utf8_stdio()


TOOLS_DIR = Path(__file__).resolve().parent
SKILL_DIR = TOOLS_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent
DEPENDENCY_FILES = (REPO_ROOT / "pyproject.toml", REPO_ROOT / "uv.lock")
SETUP_SCRIPT = SKILL_DIR / "scripts" / "setup_env.py"


def non_git_checkout_message() -> str:
    return f"""This copy of newbie-ppt is not a Git checkout, so it cannot be updated automatically.

Repository path:
  {REPO_ROOT}

If you installed with Download ZIP:
  1. Download the latest ZIP from https://github.com/hongge-ai/newbie-ppt/releases
  2. Unzip it into a new folder.
  3. Copy your old .env and projects/ folder into the new folder.
  4. Run: python skills/ppt-master/scripts/setup_env.py

If you want one-command updates next time, install with Git clone:
  git clone https://github.com/hongge-ai/newbie-ppt.git

If you installed through a skill marketplace, update or reinstall through the
same marketplace / skills tool."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Pull the latest repository changes and sync Python dependencies "
            "only when the uv dependency manifest changes."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--skip-deps",
        action="store_true",
        help="Skip Python dependency sync even if the dependency manifest changed.",
    )
    return parser.parse_args(argv)


def print_status(message: str = "") -> None:
    """Print progress/status messages to stderr."""
    print(message, file=sys.stderr)


def run_command(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=REPO_ROOT,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def dependencies_digest() -> str | None:
    """Hash the uv dependency manifest: pyproject.toml + uv.lock."""
    if not any(path.exists() for path in DEPENDENCY_FILES):
        return None

    digest = hashlib.sha256()
    for path in DEPENDENCY_FILES:
        digest.update(b"file\0")
        if not path.is_file():
            digest.update(b"missing\0")
            continue
        try:
            content = path.read_bytes()
        except OSError as exc:
            raise RuntimeError(f"Unable to read dependency manifest {path}: {exc}") from exc
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def ensure_git_available() -> None:
    if shutil.which("git") is None:
        raise RuntimeError("Missing executable: git")


def ensure_git_checkout() -> None:
    if not (REPO_ROOT / ".git").exists():
        raise RuntimeError(non_git_checkout_message())


def ensure_clean_tracked_worktree() -> None:
    status = run_command(["git", "status", "--porcelain", "--untracked-files=no"], check=False)
    if status.returncode != 0:
        details = (status.stderr or status.stdout or "").strip()
        raise RuntimeError(details or "Unable to inspect git status.")

    if status.stdout.strip():
        raise RuntimeError(
            "Tracked local changes detected. Please commit or stash them before running the update command."
        )


def get_head_revision() -> str:
    result = run_command(["git", "rev-parse", "HEAD"])
    return result.stdout.strip()


def sync_python_dependencies() -> None:
    if not any(path.exists() for path in DEPENDENCY_FILES):
        print_status("Dependency manifest (pyproject.toml / uv.lock) not found; skipping sync.")
        return

    uv = shutil.which("uv")
    if uv is None:
        print_status(
            "uv not found on PATH. Bootstrap it first with:\n"
            f"  python {SETUP_SCRIPT.relative_to(REPO_ROOT).as_posix()}\n"
            "Skipping Python dependency sync."
        )
        return

    print_status("Dependency manifest changed. Syncing Python dependencies with uv...")
    # --inexact: add/update without pruning optional groups the user installed.
    result = run_command([uv, "sync", "--inexact"])
    if result.stdout.strip():
        print_status(result.stdout.strip())
    if result.stderr.strip():
        print_status(result.stderr.strip())


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        ensure_git_checkout()
        ensure_git_available()
        ensure_clean_tracked_worktree()

        before_head = get_head_revision()
        before_dependencies = dependencies_digest()

        print_status(f"Repository: {REPO_ROOT}")
        pull_result = run_command(["git", "pull", "--ff-only"])
        if pull_result.stdout.strip():
            print_status(pull_result.stdout.strip())
        if pull_result.stderr.strip():
            print_status(pull_result.stderr.strip())

        after_head = get_head_revision()
        after_dependencies = dependencies_digest()

        if before_head == after_head:
            print_status("Repository is already up to date.")
        else:
            print_status(f"Updated from {before_head[:7]} to {after_head[:7]}.")

        if args.skip_deps:
            print_status("Skipped Python dependency sync (--skip-deps).")
        elif before_dependencies != after_dependencies:
            sync_python_dependencies()
        else:
            print_status(
                "Dependency manifest unchanged. Skipping Python dependency sync."
            )

        print_status(
            "Note: system dependencies such as Node.js and Pandoc still need "
            "to be installed manually."
        )
        return 0
    except subprocess.CalledProcessError as exc:
        details = (exc.stderr or exc.stdout or "").strip()
        print(details or "Command failed.", file=sys.stderr)
        return exc.returncode or 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
