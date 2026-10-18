import tempfile
import unittest
from pathlib import Path

from scripts.release_notes import release_notes


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "CHANGELOG.md"

    def read(self, content):
        self.path.write_text(content, encoding="utf-8", newline="")
        return release_notes("0.1.1", self.path)

    def test_selects_only_the_exact_version_and_preserves_markdown(self):
        notes = (
            "### Added\n\n- **Journal** entries.\n- Unicode: Привет.\n\n### Fixed\n\n- Grouping."
        )
        content = (
            "# Changelog\n\n## Unreleased\nFuture\n## 0.1.10\nOther\n"
            f"## 0.1.1\n\n{notes}\n\n## 0.1.0\nOlder\n"
        )
        self.assertEqual(self.read(content), notes)

    def test_supports_bracketed_versions_with_dates_and_windows_line_endings(self):
        self.assertEqual(
            self.read(
                "\ufeff# Changelog\r\n\r\n## [0.1.1] - 2026-10-18\r\n\r\n"
                "### Fixed\r\n\r\n- Grouping.\r\n"
            ),
            "### Fixed\n\n- Grouping.",
        )

    def test_keeps_headings_inside_fenced_examples(self):
        for fence in ("```", "~~~~"):
            with self.subTest(fence=fence):
                notes = (
                    f"Example:\n\n{fence}markdown\n## 0.1.1\n## Other heading\n{fence}\n\n- Done."
                )
                self.assertEqual(self.read(f"## 0.1.1\n{notes}\n## 0.1.0\nOlder"), notes)

    def test_fenced_version_examples_do_not_count_as_release_entries(self):
        with self.assertRaisesRegex(ValueError, "no '## 0.1.1' entry"):
            self.read("# Changelog\n\n```markdown\n## 0.1.1\nExample only\n```\n")

    def test_rejects_missing_empty_and_duplicate_versions(self):
        for content, error in (
            ("## 0.1.10\nWrong version", "no '## 0.1.1' entry"),
            ("## 0.1.1\n\n## 0.1.0\nOlder", "empty"),
            ("## 0.1.1\nOne\n## [0.1.1] - 2026-10-18\nTwo", "duplicate"),
        ):
            with self.subTest(content=content), self.assertRaisesRegex(ValueError, error):
                self.read(content)

    def test_rejects_a_missing_file(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            release_notes("0.1.1", self.path)


if __name__ == "__main__":
    unittest.main()
