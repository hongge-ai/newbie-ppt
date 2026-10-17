#!/usr/bin/env python3
"""PPT Master - Compact Style Tests

Exercise the deck-level root-font unification in compact_svg_styles.py:
per-page compaction can hoist different most-common fonts onto pages that
share one data-pptx Master, which makes the shared Master/Layout signature
diverge. Directory compaction computes one font per Master group and sets
it as every page's root default (structure-tagged trees only).

Usage:
    cd skills/ppt-master/scripts && python3 -m unittest tests.test_compact_svg_styles

Dependencies:
    None (standard library only)
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import compact_svg_styles as css  # noqa: E402

SVG_NS = "http://www.w3.org/2000/svg"
TEXT = "{%s}text" % SVG_NS


def parse(svg: str) -> ET.Element:
    return ET.fromstring(svg)


def page(body: str, master: str = "m") -> str:
    return (
        f'<svg xmlns="{SVG_NS}" viewBox="0 0 100 100" '
        f'data-pptx-master="{master}" data-pptx-layout="l">{body}</svg>'
    )


ARIAL_PAGE = page(
    '<g><text x="10" y="20" font-family="Arial">A</text></g>'
    '<g><text x="10" y="40" font-family="Arial">B</text></g>'
)
SIMSUN_PAGE = page(
    '<text x="10" y="20" font-family="SimSun">一</text>'
    '<text x="10" y="40" font-family="SimSun">二</text>'
    '<text x="10" y="60" font-family="SimSun">三</text>'
)


class RelocalizeRootTypographyTests(unittest.TestCase):
    def test_root_value_moves_to_unstyled_text_only(self) -> None:
        root = parse(
            '<svg xmlns="http://www.w3.org/2000/svg" font-family="Serif">'
            '<g><text id="t1">plain</text></g>'
            '<g font-family="Monospace"><text id="t2">grouped</text></g>'
            '<text id="t3" font-family="Cursive">own</text>'
            "</svg>"
        )
        css.relocalize_root_typography(root)

        self.assertIsNone(root.get("font-family"))
        self.assertEqual(root.find(".//*[@id='t1']").get("font-family"), "Serif")
        # Inherits from its <g>, not the root: left untouched.
        self.assertIsNone(root.find(".//*[@id='t2']").get("font-family"))
        self.assertEqual(root.find(".//*[@id='t3']").get("font-family"), "Cursive")


class PerTreeBehaviorTests(unittest.TestCase):
    def test_without_hint_root_font_is_hoisted_per_page(self) -> None:
        # Import-projection callers rely on this canonical form: one direct
        # root font-family default, children keep only real overrides.
        root = parse(ARIAL_PAGE)
        stats = css.compact_svg_style_tree(root)

        self.assertEqual(root.get("font-family"), "Arial")
        self.assertGreaterEqual(stats.root_font_defaults, 1)
        for text in root.iter(TEXT):
            self.assertIsNone(text.get("font-family"))

    def test_with_hint_shared_font_replaces_page_font(self) -> None:
        root = parse(ARIAL_PAGE)
        stats = css.compact_svg_style_tree(root, root_font_family="SimSun")

        self.assertEqual(root.get("font-family"), "SimSun")
        self.assertEqual(stats.root_font_unified, 1)
        # The page's own Arial is baked into its texts: no rendering change.
        for text in root.iter(TEXT):
            self.assertEqual(text.get("font-family"), "Arial")

    def test_hint_ignored_without_structure_markers(self) -> None:
        plain = ARIAL_PAGE.replace(' data-pptx-master="m" data-pptx-layout="l"', "")
        root = parse(plain)
        stats = css.compact_svg_style_tree(root, root_font_family="SimSun")

        self.assertEqual(root.get("font-family"), "Arial")
        self.assertEqual(stats.root_font_unified, 0)

    def test_hint_skipped_when_a_text_has_no_family(self) -> None:
        body = (
            '<text x="10" y="20" font-family="Arial">A</text>'
            '<text x="10" y="40">no family</text>'
        )
        root = parse(page(body))
        stats = css.compact_svg_style_tree(root, root_font_family="SimSun")
        self.assertEqual(stats.root_font_unified, 0)


class DeckRootFontHintsTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)

    def write(self, name: str, svg: str) -> Path:
        path = self.directory / name
        path.write_text(svg, encoding="utf-8")
        return path

    def test_hint_is_most_common_family_across_the_group(self) -> None:
        files = [
            self.write("a.svg", ARIAL_PAGE),
            self.write("b.svg", SIMSUN_PAGE),
            self.write("other.svg", page('<text font-family="Serif">S</text>', master="n")),
            self.write("plain.svg", ARIAL_PAGE.replace(' data-pptx-master="m" data-pptx-layout="l"', "")),
        ]
        hints = css._deck_root_font_hints(files)

        self.assertEqual(hints, {"m": "SimSun", "n": "Serif"})

    def test_unresolved_family_page_contributes_nothing(self) -> None:
        unresolved = page(
            '<text x="10" y="20" font-family="Arial">A</text>'
            '<text x="10" y="40">no family</text>'
        )
        hints = css._deck_root_font_hints([
            self.write("a.svg", ARIAL_PAGE),
            self.write("u.svg", unresolved),
        ])
        self.assertEqual(hints, {"m": "Arial"})


class DirectoryFlowTests(unittest.TestCase):
    def test_directory_run_gives_shared_master_one_root_font(self) -> None:
        temporary = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        (directory / "a.svg").write_text(ARIAL_PAGE, encoding="utf-8")
        (directory / "b.svg").write_text(SIMSUN_PAGE, encoding="utf-8")

        with patch.object(
            sys, "argv",
            ["compact_svg_styles.py", str(directory), "--inplace"],
        ):
            css.main()

        roots = [
            ET.fromstring((directory / name).read_text(encoding="utf-8"))
            for name in ("a.svg", "b.svg")
        ]
        self.assertEqual(
            {root.get("font-family") for root in roots}, {"SimSun"}
        )


if __name__ == "__main__":
    unittest.main()
