#!/usr/bin/env python3
"""newbie-ppt - Setup Script Tests

Exercise the pure selection/mirror logic of setup_env.py. No uv, pip, or
network access happens here.

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_setup_env

Dependencies:
    None (standard library only)
"""

import argparse
import re
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import setup_env  # noqa: E402


def namespace(**kwargs) -> argparse.Namespace:
    base = {"core": False, "group": None, "list_groups": False}
    base.update(kwargs)
    return argparse.Namespace(**base)


class ParseArgsTests(unittest.TestCase):
    def test_defaults(self) -> None:
        args = setup_env.parse_args([])
        self.assertFalse(args.core)
        self.assertIsNone(args.group)
        self.assertFalse(args.list_groups)

    def test_core_and_group_are_mutually_exclusive(self) -> None:
        with self.assertRaises(SystemExit):
            setup_env.parse_args(["--core", "--group", "pdf"])

    def test_unknown_option_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            setup_env.parse_args(["--nope"])


class ResolveSelectionTests(unittest.TestCase):
    def test_default_selects_all_groups(self) -> None:
        mode, groups = setup_env.resolve_selection(namespace())
        self.assertEqual(mode, "all")
        self.assertEqual(groups, list(setup_env.ALL_GROUPS))

    def test_core_only(self) -> None:
        mode, groups = setup_env.resolve_selection(namespace(core=True))
        self.assertEqual(mode, "core")
        self.assertEqual(groups, ["core"])

    def test_selective_adds_core(self) -> None:
        mode, groups = setup_env.resolve_selection(namespace(group="web,pdf"))
        self.assertEqual(mode, "selective")
        self.assertEqual(groups, ["core", "web", "pdf"])

    def test_selective_strips_whitespace(self) -> None:
        _, groups = setup_env.resolve_selection(namespace(group=" web , pdf "))
        self.assertEqual(groups, ["core", "web", "pdf"])

    def test_unknown_group_exits(self) -> None:
        with self.assertRaises(SystemExit):
            setup_env.resolve_selection(namespace(group="pdf,typos"))

    def test_empty_group_list_exits(self) -> None:
        with self.assertRaises(SystemExit):
            setup_env.resolve_selection(namespace(group=","))


class SyncArgsTests(unittest.TestCase):
    def test_all_mode(self) -> None:
        self.assertEqual(
            setup_env.sync_args("all", list(setup_env.ALL_GROUPS)),
            ["--all-groups"],
        )

    def test_core_mode_has_no_group_flags(self) -> None:
        self.assertEqual(setup_env.sync_args("core", ["core"]), [])

    def test_selective_mode_repeats_group_flags(self) -> None:
        self.assertEqual(
            setup_env.sync_args("selective", ["core", "pdf", "web"]),
            ["--group", "pdf", "--group", "web"],
        )


class AgplTests(unittest.TestCase):
    def test_triggered_by_pdf_group(self) -> None:
        self.assertTrue(setup_env.agpl_needed(["core", "pdf"]))
        self.assertTrue(setup_env.agpl_needed(list(setup_env.ALL_GROUPS)))

    def test_not_triggered_without_pdf(self) -> None:
        self.assertFalse(setup_env.agpl_needed(["core"]))
        self.assertFalse(setup_env.agpl_needed(["core", "web", "media"]))


class RegistryConsistencyTests(unittest.TestCase):
    def test_import_registry_covers_every_group(self) -> None:
        self.assertEqual(set(setup_env.GROUP_IMPORTS), set(setup_env.ALL_GROUPS))

    def test_group_order_starts_with_core(self) -> None:
        self.assertEqual(setup_env.ALL_GROUPS[0], "core")
        self.assertEqual(setup_env.ALL_GROUPS[1:], tuple(setup_env.GROUP_DESCRIPTIONS))


@unittest.skipUnless(
    sys.version_info >= (3, 11) and (setup_env.REPO_ROOT / "pyproject.toml").is_file(),
    "tomllib and pyproject.toml required",
)
class PyprojectDriftTests(unittest.TestCase):
    """Guard against setup_env.py drifting away from pyproject.toml."""

    REQUIREMENT_NAME = re.compile(r"^\s*([A-Za-z0-9._-]+)")

    def requirement_names(self, lines: list[str]) -> set[str]:
        names = set()
        for line in lines:
            match = self.REQUIREMENT_NAME.match(line)
            if match:
                names.add(match.group(1).lower().replace("_", "-"))
        return names

    def test_optional_groups_match_pyproject(self) -> None:
        import tomllib

        with (setup_env.REPO_ROOT / "pyproject.toml").open("rb") as handle:
            data = tomllib.load(handle)
        declared = data.get("dependency-groups", {})
        self.assertEqual(
            set(declared),
            set(setup_env.GROUP_DESCRIPTIONS),
            "pyproject dependency-groups and setup_env GROUP_DESCRIPTIONS disagree",
        )
        for group, requirements in declared.items():
            self.assertTrue(requirements, f"group {group} is empty in pyproject")

    def test_import_registry_mentions_every_declared_requirement(self) -> None:
        import tomllib

        with (setup_env.REPO_ROOT / "pyproject.toml").open("rb") as handle:
            data = tomllib.load(handle)
        declared = dict(data.get("dependency-groups", {}))
        declared["core"] = data["project"]["dependencies"]
        for group, requirements in declared.items():
            names = self.requirement_names(requirements)
            # google-genai -> google.genai, PyYAML -> yaml: compare loosely by
            # asserting the group's import list is non-empty and the package
            # count matches, so adding a package forces a registry update.
            self.assertEqual(
                len(names),
                len(setup_env.GROUP_IMPORTS[group]),
                f"{group}: {len(names)} packages in pyproject but "
                f"{len(setup_env.GROUP_IMPORTS[group])} imports registered",
            )


if __name__ == "__main__":
    unittest.main()
