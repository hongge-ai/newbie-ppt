#!/usr/bin/env python3
"""newbie-ppt - Slim Distribution Builder

Build the slim distribution ZIP with `git archive` (tracked files only,
no .git history; paths marked export-ignore in .gitattributes — e.g.
docs/assets — are left out) and print a size summary.

Usage:
    uv run python skills/ppt-master/scripts/make_dist.py            # dist/newbie-ppt-<version>.zip
    uv run python skills/ppt-master/scripts/make_dist.py --list     # only list what would ship

Upload the artifact to https://github.com/hongge-ai/newbie-ppt/releases
(manual step — this script does not publish).

Dependencies:
    None (standard library only)
"""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

from console_encoding import configure_utf8_stdio

configure_utf8_stdio()


TOOLS_DIR = Path(__file__).resolve().parent
SKILL_DIR = TOOLS_DIR.parent
REPO_ROOT = SKILL_DIR.parent.parent
DIST_DIR = REPO_ROOT / "dist"

AGPL_REMINDER = (
    "Reminder: the `pdf` group (PyMuPDF, AGPL-3.0) is NOT bundled here — users "
    "install it via uv. Redistribution guidance: skills/ppt-master/scripts/docs/conversion.md"
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the slim distribution ZIP from the current HEAD.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List the files that would ship (from the archive index) and exit.",
    )
    return parser.parse_args(argv)


def read_version() -> str:
    with (REPO_ROOT / "pyproject.toml").open("rb") as handle:
        data = tomllib.load(handle)
    return str(data["project"]["version"])


def archive_zip() -> zipfile.ZipFile:
    """Return the HEAD archive as a ZipFile (tracked files, export-ignore applied)."""
    result = subprocess.run(
        ["git", "archive", "--format=zip", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=True,
    )
    return zipfile.ZipFile(io.BytesIO(result.stdout))


def human_size(num_bytes: int) -> str:
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def build_archive(destination: Path, archive: zipfile.ZipFile) -> None:
    with destination.open("wb") as handle:
        handle.write(archive.fp.getvalue())  # type: ignore[union-attr]
        handle.flush()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    with archive_zip() as archive:
        entries = sorted(archive.namelist())
        print(f"Archive index (HEAD): {len(entries)} files")
        violations = [entry for entry in entries if entry.startswith("docs/assets/")]
        if violations:
            print(f"[ERROR] {len(violations)} docs/assets file(s) would ship: {violations[:3]} ...", file=sys.stderr)
            print("Check the export-ignore rules in .gitattributes.", file=sys.stderr)
            return 1
        for required in ("pyproject.toml", "uv.lock"):
            if required not in entries:
                print(f"[ERROR] {required} missing from the archive index.", file=sys.stderr)
                return 1

        if args.list:
            for entry in entries:
                print(f"  {entry}")
            return 0

        version = read_version()
        DIST_DIR.mkdir(exist_ok=True)
        destination = DIST_DIR / f"newbie-ppt-slim-{version}.zip"
        build_archive(destination, archive)

        uncompressed = sum(info.file_size for info in archive.infolist())
        print(f"Built: {destination.relative_to(REPO_ROOT).as_posix()}")
        print(f"  zip size:     {human_size(destination.stat().st_size)}")
        print(f"  uncompressed: {human_size(uncompressed)} ({len(entries)} files)")
        print(AGPL_REMINDER)
        print("Next: upload to https://github.com/hongge-ai/newbie-ppt/releases (manual step).")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
