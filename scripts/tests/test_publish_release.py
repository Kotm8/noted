import argparse
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from scripts import desktop_update, publish_release, release_notes, release_version
from scripts.tests.signing_fixture import sign


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.notes = "### Added\n\n- Notes from the changelog."
        self.changelog = self.directory / "CHANGELOG.md"
        self.changelog.write_text(f"# Changelog\n\n## 0.1.0\n\n{self.notes}\n", encoding="utf-8")
        self.commit = "a" * 40
        self.head = self.commit
        self.calls = []
        self.uploads = {}
        self.fail_upload = False
        self.advance_after_upload = False
        self.existing_release = None
        for name in ("backend", "web"):
            (self.directory / f"{name}.json").write_text(
                json.dumps({"containerimage.digest": "sha256:" + "b" * 64})
            )
        clients = self.directory / "clients"
        clients.mkdir()
        (clients / "Noted_android.apk").write_bytes(b"signed-apk-fixture")
        (clients / "Noted_0.1.0_x64-setup.exe").write_bytes(b"windows-installer-fixture")
        key, signature = sign(b"windows-installer-fixture", "0.1.0")
        (clients / "Noted_0.1.0_x64-setup.exe.sig").write_text(signature)
        key_patch = patch.object(desktop_update, "public_key", return_value=key)
        key_patch.start()
        self.addCleanup(key_patch.stop)
        self.arguments = argparse.Namespace(
            backend_metadata=self.directory / "backend.json",
            web_metadata=self.directory / "web.json",
            clients_directory=clients,
            version="0.1.0",
        )

    def api(self, path, data=None, method="GET", content_type="application/json"):
        self.calls.append((method, path, data))
        if path.endswith("/git/ref/heads/main"):
            return {"object": {"sha": self.head}}
        if "/releases/tags/" in path:
            if self.existing_release is not None:
                return self.existing_release
            raise HTTPError(path, 404, "not found", {}, None)
        if method == "POST" and path.endswith("/releases"):
            self.assertTrue(data["draft"])
            self.assertEqual(data["name"], "v0.1.0")
            return {"id": 1, "assets": []}
        if path.startswith("https://uploads.github.com/"):
            if self.fail_upload:
                raise OSError("test upload failure")
            name = parse_qs(urlsplit(path).query)["name"][0]
            self.uploads[name] = data
            if self.advance_after_upload:
                self.head = "c" * 40
            return {}
        if method == "PATCH":
            self.assertIn("Noted_android.apk", self.uploads)
            self.assertIn("Noted_0.1.0_x64-setup.exe", self.uploads)
            self.assertIn("SHA256SUMS", self.uploads)
            return {}
        raise AssertionError(f"Unexpected API request: {method} {path}")

    def publish(self):
        argv = [
            "publish_release.py",
            "--backend-metadata",
            str(self.arguments.backend_metadata),
            "--web-metadata",
            str(self.arguments.web_metadata),
            "--clients-directory",
            str(self.arguments.clients_directory),
            "--version",
            self.arguments.version,
        ]
        with (
            patch.dict(
                os.environ,
                {
                    "GITHUB_REPOSITORY": "Kotm8/noted",
                    "GITHUB_SHA": self.commit,
                },
            ),
            patch("sys.argv", argv),
            patch.object(publish_release, "api", self.api),
            patch.object(release_notes, "ROOT", self.directory),
            patch.object(release_version, "release_version", return_value="0.1.0"),
        ):
            publish_release.main()

    def test_publishes_only_after_all_server_and_client_assets_are_uploaded(self):
        self.publish()
        self.assertEqual(self.calls[-1][0], "PATCH")
        created = next(
            data
            for method, path, data in self.calls
            if method == "POST" and path.endswith("/releases")
        )
        self.assertEqual(created["body"], self.notes)
        self.assertEqual(self.calls[-1][2]["body"], self.notes)
        manifest = json.loads(self.uploads["noted-release.json"])
        self.assertEqual(manifest["version"], "0.1.0")
        self.assertEqual(manifest["commit"], self.commit)
        self.assertEqual(
            manifest["bundle_sha256"],
            hashlib.sha256(self.uploads["noted-deploy.tar.gz"]).hexdigest(),
        )
        for line in self.uploads["SHA256SUMS"].decode().splitlines():
            digest, name = line.split("  ", 1)
            self.assertEqual(digest, hashlib.sha256(self.uploads[name]).hexdigest())

    def test_watch_downloads_are_published_and_included_in_checksums(self):
        (self.arguments.clients_directory / "Noted_wear.apk").write_bytes(b"watch-apk-fixture")
        self.publish()
        self.assertIn("Noted_wear.apk", self.uploads)
        self.assertIn("Noted_wear.apk", self.uploads["SHA256SUMS"].decode())
        self.assertNotIn("Noted_watchface.apk", self.uploads)

    def test_desktop_feed_uses_the_same_immutable_release_and_verified_signature(self):
        self.publish()
        feed = json.loads(self.uploads["noted-desktop-update.json"])
        self.assertEqual(feed["version"], "0.1.0")
        self.assertEqual(feed["notes"], self.notes)
        target = feed["platforms"]["windows-x86_64"]
        self.assertEqual(
            target["url"],
            f"https://github.com/kotm8/noted/releases/download/main-{self.commit}/Noted_0.1.0_x64-setup.exe",
        )
        self.assertEqual(
            target["signature"].encode(), self.uploads["Noted_0.1.0_x64-setup.exe.sig"]
        )

    def test_missing_or_invalid_desktop_signatures_stop_before_publication(self):
        signature = self.arguments.clients_directory / "Noted_0.1.0_x64-setup.exe.sig"
        signature.unlink()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])
        signature.write_text("invalid-signature")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])

    def test_upload_failure_keeps_the_release_a_draft(self):
        self.fail_upload = True
        with self.assertRaises(OSError):
            self.publish()
        self.assertFalse(any(method == "PATCH" for method, _, _ in self.calls))

    def test_separate_watch_face_is_not_a_release_download(self):
        (self.arguments.clients_directory / "Noted_watchface.apk").write_bytes(b"face-fixture")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])
        (self.arguments.clients_directory / "Noted_wear.apk").write_bytes(b"watch-fixture")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])

    def test_stale_commit_never_creates_a_release(self):
        self.head = "c" * 40
        with self.assertRaises(SystemExit):
            self.publish()
        self.assertFalse(any(method != "GET" for method, _, _ in self.calls))

    def test_wrong_app_version_is_rejected_before_any_api_call(self):
        self.arguments.version = "9.9.9"
        with self.assertRaises(SystemExit):
            self.publish()
        self.assertEqual(self.calls, [])

    def test_main_advancing_during_upload_keeps_the_release_a_draft(self):
        self.advance_after_upload = True
        with self.assertRaises(SystemExit):
            self.publish()
        self.assertTrue(self.uploads)
        self.assertFalse(any(method == "PATCH" for method, _, _ in self.calls))

    def test_published_releases_are_never_replaced(self):
        self.existing_release = {"id": 1, "draft": False}
        self.publish()
        self.assertFalse(any(method != "GET" for method, _, _ in self.calls))

    def test_draft_retries_refresh_release_notes(self):
        self.existing_release = {"id": 1, "draft": True, "body": "Old commit message"}
        self.publish()
        self.assertFalse(
            any(method == "POST" and path.endswith("/releases") for method, path, _ in self.calls)
        )
        self.assertEqual(self.calls[-1][2]["body"], self.notes)
        self.assertFalse(self.calls[-1][2]["draft"])

    def test_invalid_changelog_stops_before_any_api_calls(self):
        for content in (
            "## 0.1.1\nOther version",
            "## 0.1.0\n",
            "## 0.1.0\nOne\n## 0.1.0\nTwo",
        ):
            with self.subTest(content=content):
                self.changelog.write_text(content, encoding="utf-8")
                with self.assertRaises(SystemExit):
                    self.publish()
                self.assertEqual(self.calls, [])
        self.changelog.unlink()
        with self.assertRaises(SystemExit):
            self.publish()
        self.assertEqual(self.calls, [])

    def test_incomplete_downloads_and_invalid_metadata_fail_before_any_api_call(self):
        apk = self.arguments.clients_directory / "Noted_android.apk"
        apk.unlink()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])
        apk.write_bytes(b"apk")
        self.arguments.backend_metadata.write_text(json.dumps({"containerimage.digest": "wrong"}))
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
