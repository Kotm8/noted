import gzip
import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.config import Config
from noted_updater.docker import OperationError
from noted_updater.engine import Engine
from noted_updater.files import read_json, write_file, write_json
from noted_updater.github import GitHubRedirects, GitHubSource, trusted_url
from noted_updater.release import Manifest, Release, extract_bundle
from noted_updater.worker import Worker, process_lock


def bundle(names=("compose.production.yaml", "Caddyfile.production"), link=False):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for name in names:
            member = tarfile.TarInfo(name)
            if link:
                member.type = tarfile.SYMTYPE
                member.linkname = "/etc/passwd"
            else:
                member.size = 4
            archive.addfile(member, None if link else io.BytesIO(b"test"))
    return buffer.getvalue()


def manifest_data(raw):
    return {
        "format": 1,
        "channel": "main",
        "configuration_version": 1,
        "api_version": 1,
        "minimum_updater_version": 1,
        "repository": "owner/noted",
        "commit": "b" * 40,
        "sequence": 2,
        "version": "0.1.0-main.bbbbbbbbbbbb",
        "schema_revision": "0003_attachment_order",
        "supported_source_schemas": ["0003_attachment_order"],
        "backend_image": "ghcr.io/owner/noted-backend@sha256:" + "c" * 64,
        "web_image": "ghcr.io/owner/noted-web@sha256:" + "d" * 64,
        "bundle_sha256": hashlib.sha256(raw).hexdigest(),
    }


class Source:
    def __init__(self, raw):
        self.raw = raw
        self.release = Release(
            Manifest.parse(manifest_data(raw), "owner/noted"),
            "e" * 64,
            "https://api.github.com/bundle",
            "https://github.com/owner/noted/releases/tag/main-" + "b" * 40,
            "A release",
            "2026-10-15T12:00:00Z",
        )

    def latest(self):
        return self.release

    def bundle(self, release):
        return self.raw


class FakeDocker:
    def __init__(self):
        self.events = []
        self.fail = None
        self.revision = "0003_attachment_order"
        self.change_schema = False
        self.bad_volume = False
        self.changed_database = False

    def resolved(self, deployment):
        current = deployment["compose"] == "initial.yaml"
        data = manifest_data(bundle())
        return {
            "services": {
                "db": {"image": "postgres:18.4-alpine"},
                "backend": {
                    "image": "old-backend" if current else data["backend_image"],
                    "environment": {
                        "NOTED_APP_ORIGIN": "https://notes.example.com",
                        "NOTED_DATABASE_URL": "other"
                        if self.changed_database and not current
                        else "original",
                    },
                    "volumes": [{"type": "volume", "target": "/data", "source": "notes"}],
                },
                "web": {"image": "old-web" if current else data["web_image"]},
                "migrate": {"image": "old-backend" if current else data["backend_image"]},
            },
            "volumes": {
                "notes": {"name": "changed" if self.bad_volume and not current else "notes"}
            },
        }

    def required_space(self, deployment):
        return 1

    def ensure_image(self, image):
        self.events.append("download")
        if self.fail == "download":
            raise OperationError("Download failed.")

    def compose(self, deployment, arguments, label, **kwargs):
        event = "migration" if "migrate" in arguments else "stop"
        self.events.append(event)
        if event == "migration" and self.change_schema:
            self.revision = "future_schema"
        if self.fail == event:
            raise OperationError(event + " failed.")

    def start(self, deployment):
        self.events.append("start-old" if deployment["compose"] == "initial.yaml" else "start-new")
        if self.fail == "start" and deployment["compose"] != "initial.yaml":
            raise OperationError("Restart failed.")

    def schema(self, deployment):
        return self.revision

    def backup(self, deployment, directory):
        self.events.append("backup")
        directory.mkdir(parents=True)
        if self.fail == "backup":
            raise OperationError("Backup failed.")
        write_file(directory / "database.dump", b"PGDMP")


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.config = Config(Path(self.temporary.name), "owner/noted")
        for path in (self.config.state, self.config.requests, self.config.maintenance.parent):
            path.mkdir(parents=True)
        self.source = Source(bundle())
        self.docker = FakeDocker()
        self.engine = Engine(self.config, self.source, self.docker, lambda *args: None)
        self.installed = {
            "compose": "initial.yaml",
            "origin": "https://notes.example.com",
            "commit": "a" * 40,
            "schema": "0003_attachment_order",
            "version": "0.1.0",
            "sequence": 1,
        }
        write_json(self.engine.ledger, self.installed)
        write_json(self.config.state / "service.json", {"installed": self.installed})
        self.request = {
            "id": str(uuid4()),
            "commit": "b" * 40,
            "manifest_sha256": "e" * 64,
        }

    def job(self):
        return read_json(self.config.state / "job.json")

    def test_check_and_background_download_never_install(self):
        self.engine.download_available(self.engine.check())
        self.assertEqual(self.docker.events, ["download", "download"])
        self.assertEqual(read_json(self.engine.ledger), self.installed)
        self.assertFalse(self.config.maintenance.exists())
        self.assertEqual(read_json(self.config.state / "service.json")["download_status"], "ready")
        self.engine.download_available(self.source.release)
        self.assertEqual(len(self.docker.events), 2)

    def test_apply_backs_up_before_migration_and_never_restarts_database(self):
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "succeeded")
        self.assertEqual(
            self.docker.events, ["download", "download", "stop", "backup", "migration", "start-new"]
        )
        self.assertFalse(self.config.maintenance.exists())
        self.assertEqual(read_json(self.engine.ledger)["commit"], "b" * 40)
        self.assertTrue(
            (self.config.directory / "backups" / self.request["id"] / "metadata.json").exists()
        )

    def test_stale_release_fails_before_downtime(self):
        self.request["manifest_sha256"] = "f" * 64
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "failed")
        self.assertEqual(self.docker.events, [])

    def test_backup_failure_never_migrates(self):
        self.docker.fail = "backup"
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "failed")
        self.assertNotIn("migration", self.docker.events)
        self.assertIn("start-old", self.docker.events)

    def test_failed_start_can_restore_old_image_only_with_unchanged_schema(self):
        self.docker.fail = "start"
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "failed")
        self.assertIn("start-old", self.docker.events)
        self.assertEqual(read_json(self.engine.ledger), self.installed)

    def test_migration_failure_after_schema_change_keeps_maintenance(self):
        self.docker.fail = "migration"
        self.docker.change_schema = True
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "needs_recovery")
        self.assertTrue(self.config.maintenance.exists())
        self.assertNotIn("start-old", self.docker.events)
        self.docker.fail = None
        self.engine.resume()
        self.assertEqual(self.job()["status"], "succeeded")
        self.assertFalse(self.config.maintenance.exists())

    def test_public_verification_failure_does_not_record_release(self):
        def failed(*args):
            raise OperationError("Wrong public release.")

        self.engine.verifier = failed
        self.engine.apply(self.request)
        self.assertEqual(read_json(self.engine.ledger), self.installed)
        self.assertEqual(self.job()["status"], "needs_recovery")

    def test_failed_resume_remains_recoverable(self):
        self.docker.fail = "migration"
        self.docker.change_schema = True
        self.engine.apply(self.request)
        with self.assertRaises(OperationError):
            self.engine.resume()
        self.assertEqual(self.job()["status"], "needs_recovery")
        self.assertTrue(self.config.maintenance.exists())

    def test_rejects_replaced_volumes(self):
        self.docker.bad_volume = True
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "failed")
        self.assertEqual(self.docker.events, [])

    def test_rejects_replaced_database_credentials(self):
        self.docker.changed_database = True
        self.engine.apply(self.request)
        self.assertEqual(self.job()["status"], "failed")
        self.assertEqual(self.docker.events, [])

    def test_insufficient_space_keeps_app_running(self):
        self.docker.required_space = lambda deployment: 10**20
        self.engine.apply(self.request)
        self.assertEqual(self.docker.events, [])
        self.assertEqual(self.job()["status"], "failed")

    def test_partial_download_can_be_retried(self):
        raw = self.source.raw
        self.source.raw = b"broken"
        with self.assertRaises(ValueError):
            self.engine.stage(self.source.release)
        self.source.raw = raw
        self.assertTrue(Path(self.engine.stage(self.source.release)["compose"]).exists())

    def test_immutable_release_cannot_change_manifest(self):
        self.engine.stage(self.source.release)
        with self.assertRaises(OperationError):
            self.engine.stage(replace(self.source.release, manifest_sha256="f" * 64))

    def test_interrupted_download_can_retry_without_downtime(self):
        write_json(self.config.state / "job.json", {**self.request, "status": "running"})
        self.engine.interrupted()
        self.assertEqual(self.job()["status"], "failed")
        self.assertEqual(self.docker.events, [])

    def test_worker_checks_once_on_startup_then_waits_a_day(self):
        worker = Worker(self.config)
        worker.engine = self.engine
        calls = []

        def check():
            calls.append("check")
            return self.source.release

        worker.engine.check = check
        ticks = iter([0, 0, 1, 86399])
        waits = []

        def wait(seconds):
            waits.append(seconds)
            if len(waits) == 3:
                worker.stop.set()

        with (
            patch("noted_updater.worker.threading.Thread"),
            patch("noted_updater.worker.time.monotonic", side_effect=lambda: next(ticks)),
            patch.object(worker.stop, "wait", side_effect=wait),
        ):
            worker.run()
        self.assertEqual(calls, ["check"])
        self.assertNotIn("migration", self.docker.events)

    def test_worker_lock_prevents_concurrent_processes(self):
        path = self.config.control / "worker.lock"
        with process_lock(path), self.assertRaises(OSError), process_lock(path):
            pass


class ReleaseTests(unittest.TestCase):
    def test_github_release_is_bound_to_repository_and_commit(self):
        data = manifest_data(bundle())
        manifest = json.dumps(data).encode()
        source = GitHubSource("owner/noted")
        release = {
            "tag_name": "main-" + data["commit"],
            "draft": False,
            "prerelease": False,
            "assets": [
                {
                    "name": "noted-release.json",
                    "url": "https://api.github.com/repos/owner/noted/releases/assets/1",
                },
                {
                    "name": "noted-deploy.tar.gz",
                    "url": "https://api.github.com/repos/owner/noted/releases/assets/2",
                },
            ],
        }
        with patch.object(source, "download", side_effect=[json.dumps(release).encode(), manifest]):
            self.assertEqual(source.latest().manifest_sha256, hashlib.sha256(manifest).hexdigest())
        release["assets"][0]["url"] = "https://api.github.com/repos/other/noted/releases/assets/1"
        with (
            patch.object(source, "download", return_value=json.dumps(release).encode()),
            self.assertRaises(ValueError),
        ):
            source.latest()

    def test_rejects_foreign_mutable_and_incompatible_images(self):
        original = manifest_data(bundle())
        for key, value in {
            "backend_image": "ghcr.io/owner/noted-backend:latest",
            "web_image": "ghcr.io/other/noted-web@sha256:" + "d" * 64,
            "repository": "other/noted",
            "minimum_updater_version": 999,
            "sequence": True,
            "configuration_version": 2,
        }.items():
            with self.subTest(key=key), self.assertRaises(ValueError):
                Manifest.parse({**original, key: value}, "owner/noted")

    def test_rejects_tampered_traversal_and_symlink_bundles(self):
        for raw in [bundle(("../escape", "Caddyfile.production")), bundle(link=True)]:
            source = Source(raw)
            with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
                extract_bundle(raw, source.release, Path(directory))
        source = Source(bundle())
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            extract_bundle(b"tampered", source.release, Path(directory))

    def test_rejects_excessively_expanded_archive(self):
        raw = gzip.compress(b"0" * 3145729)
        source = Source(raw)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            extract_bundle(raw, source.release, Path(directory))

    def test_redirects_reject_external_hosts(self):
        for url in [
            "http://github.com/a",
            "https://github.com.evil.test/a",
            "https://x.test/a",
            "https://secret@github.com/a",
        ]:
            self.assertFalse(trusted_url(url))
        from urllib.request import Request

        redirect = GitHubRedirects().redirect_request(
            Request("https://api.github.com/a", headers={"Authorization": "Bearer secret"}),
            None,
            302,
            "Found",
            {},
            "https://release-assets.githubusercontent.com/a",
        )
        self.assertIsNone(redirect.get_header("Authorization"))


if __name__ == "__main__":
    unittest.main()
