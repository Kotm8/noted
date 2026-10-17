import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.docker import OperationError
from noted_updater.files import read_json, write_json
from noted_updater.install import Installer
from test_updater import bundle, manifest_data


class InstallationDocker:
    def __init__(self):
        self.events = []
        self.fail = False
        self.owner = None

    def ensure_image(self, image):
        self.events.append(("image", image))
        if self.fail:
            raise OperationError("Network unavailable")

    def compose(self, deployment, arguments, label, **options):
        self.events.append(("compose", arguments))
        if arguments[0] == "exec":
            self.owner = json.load(options["input_file"])
            assert self.owner["password"] not in " ".join(arguments)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.ownership = self.enterContext(patch("noted_updater.install.os.chown", create=True))
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / ".setup-id").write_text("a" * 64)
        self.data = {
            "setup_id": "a" * 64,
            "repository": "owner/noted",
            "domain": "notes.example.com",
            "server_name": 'My $notes "and" memories',
            "username": "owner",
            "password": "private-password-only-for-tests",
            "release": manifest_data(bundle()),
        }
        self.docker = InstallationDocker()
        self.phases = []
        self.finished = []

    def installer(self):
        return Installer(
            self.root,
            self.data,
            lambda phase, detail: self.phases.append(phase),
            docker=self.docker,
            finisher=self.finished.append,
        )

    def test_install_pulls_immutable_images_and_keeps_owner_secrets_out_of_files(self):
        self.installer().run()
        if os.name != "nt":
            self.ownership.assert_called_once_with(self.root / "updater/requests", 1000, 1000)
        self.assertEqual(self.docker.events[0], ("image", self.data["release"]["backend_image"]))
        self.assertEqual(self.docker.events[1], ("image", self.data["release"]["web_image"]))
        self.assertEqual(self.docker.owner["password"], self.data["password"])
        self.assertEqual(self.phases, ["images", "starting", "owner", "updater", "installed"])
        self.assertEqual(self.finished, ["owner/noted"])
        environment = (self.root / ".env").read_text()
        self.assertIn("$$notes", environment)
        for path in self.root.rglob("*"):
            if path.is_file():
                self.assertNotIn(self.data["password"], path.read_text())

    def test_retry_after_download_failure_preserves_database_identity(self):
        self.docker.fail = True
        with self.assertRaises(OperationError):
            self.installer().run()
        environment = (self.root / ".env").read_bytes()
        self.docker.fail = False
        self.installer().run()
        self.assertEqual((self.root / ".env").read_bytes(), environment)

    def test_retry_with_different_domain_does_not_touch_existing_installation(self):
        self.installer().run()
        previous = (self.root / ".env").read_bytes()
        events = list(self.docker.events)
        self.data["domain"] = "another.example.com"
        with self.assertRaises(OperationError):
            self.installer().run()
        self.assertEqual((self.root / ".env").read_bytes(), previous)
        self.assertEqual(self.docker.events, events)

    def test_finished_install_only_retries_updater_without_restarting_or_downgrading(self):
        self.installer().run()
        write_json(self.root / "updater/installed.json", {"commit": self.data["release"]["commit"]})
        self.docker.events.clear()
        self.installer().run()
        self.assertEqual(self.docker.events, [])
        write_json(self.root / "updater/installed.json", {"commit": "c" * 40})
        with self.assertRaises(OperationError):
            self.installer().run()
        self.assertEqual(read_json(self.root / "updater/installed.json")["commit"], "c" * 40)
        self.assertEqual(self.docker.events, [])

    def test_invalid_manifest_or_setup_identity_runs_no_commands(self):
        self.data["release"]["backend_image"] = "somewhere/untrusted:latest"
        with self.assertRaises(ValueError):
            self.installer().run()
        self.data["release"] = manifest_data(bundle())
        self.data["setup_id"] = "b" * 64
        with self.assertRaises(OperationError):
            self.installer().run()
        self.assertEqual(self.docker.events, [])
        self.assertFalse((self.root / ".env").exists())


if __name__ == "__main__":
    unittest.main()
