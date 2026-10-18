import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.cleanup import Cleanup, CleanupError


class FixtureCleanup(Cleanup):
    def __init__(self, root, system_directory):
        super().__init__(root, system_directory=system_directory)
        self.actions = []
        self.shared = False
        self.foreign = False
        self.container = {
            "Id": "b" * 64,
            "Config": {
                "Labels": {
                    "com.docker.compose.project": "noted",
                    "com.docker.compose.service": "db",
                    "com.docker.compose.project.working_dir": str(root),
                }
            },
        }

    def command(self, arguments):
        self.actions.append(arguments)
        return ""

    def docker(self, *arguments):
        if arguments[:2] == ("ps", "-aq"):
            return (
                "outside" if self.shared and "volume=noted_attachments" in arguments else "b" * 64
            )
        if arguments[0] == "inspect":
            return json.dumps(
                [{"Id": "outside"}] if arguments[1] == "outside" else [self.container]
            )
        if arguments[:2] == ("volume", "ls"):
            return "noted_attachments"
        if arguments[:2] == ("volume", "inspect"):
            return json.dumps(
                [
                    {
                        "Name": "noted_attachments",
                        "Labels": {
                            "com.docker.compose.project": "other" if self.foreign else "noted",
                            "com.docker.compose.volume": "attachments",
                        },
                    }
                ]
            )
        if arguments[:2] == ("network", "ls"):
            return ""
        self.actions.append(["docker", *arguments])
        return ""


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("noted_updater.cleanup.shutil.which", return_value="docker"))
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name).resolve()
        self.root = self.parent / "installation"
        self.root.mkdir()
        (self.root / ".setup-id").write_text("a" * 64)
        (self.root / ".setup.json").write_text(
            json.dumps(
                {
                    "setup_id": "a" * 64,
                    "repository": "owner/noted",
                    "server_name": "Original name",
                    "domain": "notes.example.com",
                }
            )
        )
        self.cleanup = FixtureCleanup(self.root, self.parent / "systemd")

    def inspect(self):
        return self.cleanup.inspect("owner/noted")[0]

    def test_wrong_confirmation_and_stale_inspection_run_no_destructive_commands(self):
        snapshot = self.inspect()["snapshot"]
        with self.assertRaises(CleanupError):
            self.cleanup.remove("owner/noted", "i love verity", snapshot)
        (self.root / ".env").write_text("changed=true")
        with self.assertRaises(CleanupError):
            self.cleanup.remove("owner/noted", "I LOVE VERITY", snapshot)
        self.assertEqual(self.cleanup.actions, [])

    def test_shared_or_foreign_volumes_stop_cleanup_before_any_changes(self):
        self.cleanup.shared = True
        with self.assertRaises(CleanupError):
            self.inspect()
        self.cleanup.shared = False
        self.cleanup.foreign = True
        with self.assertRaises(CleanupError):
            self.inspect()
        self.assertEqual(self.cleanup.actions, [])

    def test_other_installations_and_unknown_services_are_rejected(self):
        labels = self.cleanup.container["Config"]["Labels"]
        labels["com.docker.compose.project.working_dir"] = str(self.parent / "other")
        with self.assertRaises(CleanupError):
            self.inspect()
        labels["com.docker.compose.project.working_dir"] = str(self.root)
        labels["com.docker.compose.service"] = "amnezia"
        with self.assertRaises(CleanupError):
            self.inspect()
        self.assertEqual(self.cleanup.actions, [])

    def test_active_operations_and_invalid_markers_are_rejected(self):
        state = self.root / "updater/state"
        state.mkdir(parents=True)
        (state / "job.json").write_text('{"status":"running"}')
        with self.assertRaises(CleanupError):
            self.inspect()
        (state / "job.json").unlink()
        (self.root / ".setup-id").write_text("invalid")
        with self.assertRaises(CleanupError):
            self.inspect()
        self.assertEqual(self.cleanup.actions, [])

    def test_cleanup_only_removes_owned_resources_and_preserves_unknown_files(self):
        (self.root / "keep.txt").write_text("unrelated file")
        updater = self.root / "updater"
        updater.mkdir()
        (updater / "worker.py").write_text("fixture")
        self.cleanup.remove("owner/noted", "I LOVE VERITY", self.inspect()["snapshot"])
        self.assertEqual((self.root / "keep.txt").read_text(), "unrelated file")
        self.assertFalse(updater.exists())
        self.assertFalse((self.root / ".setup-id").exists())
        self.assertEqual(
            self.cleanup.actions,
            [
                ["docker", "stop", "--time", "30", "b" * 64],
                ["docker", "rm", "b" * 64],
                ["docker", "volume", "rm", "noted_attachments"],
            ],
        )

    def test_symlinks_outside_the_installation_are_rejected(self):
        outside = self.parent / "outside"
        outside.mkdir()
        try:
            (self.root / "updater").symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("Creating symlinks requires additional Windows privileges")
        with self.assertRaises(CleanupError):
            self.inspect()
        self.assertTrue(outside.exists())
        self.assertEqual(self.cleanup.actions, [])

    def test_unrelated_systemd_service_is_never_stopped(self):
        self.cleanup.unit.parent.mkdir()
        self.cleanup.unit.write_text(
            f"#WorkingDirectory={self.root}/updater/code\n"
            "#ExecStart=/usr/bin/python3 -m noted_updater run --config "
            f"{self.root}/updater/config.json\n"
            "WorkingDirectory=/opt/another-app\nExecStart=/bin/sleep infinity\n"
        )
        with self.assertRaises(CleanupError):
            self.inspect()
        self.assertEqual(self.cleanup.actions, [])

    def test_owned_systemd_service_is_stopped_before_owned_data_is_removed(self):
        self.cleanup.unit.parent.mkdir()
        self.cleanup.unit.write_text(
            f"WorkingDirectory={self.root}/updater/code\n"
            "ExecStart=/usr/bin/python3 -m noted_updater run --config "
            f"{self.root}/updater/config.json\n"
        )
        self.cleanup.remove("owner/noted", "I LOVE VERITY", self.inspect()["snapshot"])
        self.assertEqual(
            self.cleanup.actions[0], ["systemctl", "disable", "--now", "noted-updater.service"]
        )
        self.assertFalse(self.cleanup.unit.exists())

    @unittest.skipIf(os.name == "nt", "VPS locking uses flock on Linux")
    def test_running_installer_lock_prevents_cleanup(self):
        import fcntl

        with (self.root / ".setup.lock").open("a+b") as locked:
            fcntl.flock(locked.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(CleanupError), self.cleanup.lock():
                pass
        self.assertEqual(self.cleanup.actions, [])
