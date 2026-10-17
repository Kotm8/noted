import base64
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.config import Config
from noted_updater.docker import OperationError
from noted_updater.engine import Engine
from noted_updater.files import now, read_json, write_json
from noted_updater.host import Host
from noted_updater.ssh import SSH, fingerprint, public_ip
from test_updater import FakeDocker

KEY = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"x" * 32).decode()


class RemovalDocker(FakeDocker):
    def __init__(self):
        super().__init__()
        self.external = False
        self.foreign = False
        self.shared = False

    def resolved(self, deployment):
        return {
            "services": {name: {} for name in ("db", "backend", "web", "migrate")},
            "volumes": {
                name: {"name": f"noted_{name}", "external": self.external}
                for name in ("postgres_data", "attachments", "caddy_data", "caddy_config")
            },
        }

    def run(self, arguments, label, **kwargs):
        self.events.append(arguments[0])
        if arguments[0] == "ps":
            return "unrelated-container" if self.shared else ""
        if arguments[0] == "inspect":
            return json.dumps([{"Config": {"Labels": {"com.docker.compose.project": "other"}}}])
        return json.dumps(
            [{"Labels": {"com.docker.compose.project": "other" if self.foreign else "noted"}}]
        )


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "noted"
        self.config = Config(self.root, "owner/noted")
        for path in (self.config.state, self.config.requests, self.config.maintenance.parent):
            path.mkdir(parents=True)
        self.docker = FakeDocker()
        self.engine = Engine(self.config, None, self.docker, lambda *args: None)
        self.host = Host(self.config, self.engine)
        self.installed = {
            "compose": "initial.yaml",
            "origin": "https://notes.example.com",
            "commit": "a" * 40,
            "schema": "0003_attachment_order",
            "version": "0.1.0",
            "sequence": 1,
        }
        write_json(self.engine.ledger, self.installed)
        write_json(self.config.state / "service.json", {})
        (self.root / ".env").write_text(
            "POSTGRES_PASSWORD=preserve-me\nNOTED_DOMAIN=notes.example.com\n"
        )

    def request(self, action, **values):
        return {"id": str(uuid4()), "action": action, "created_at": now(), **values}

    def job(self):
        return read_json(self.host.job_path)

    def test_remove_requires_exact_confirmation_before_any_destructive_call(self):
        self.assertFalse(self.host.apply(self.request("remove", confirmation="i love verity")))
        self.assertEqual(self.job()["status"], "failed")
        self.assertNotIn("stop", self.docker.events)
        with self.assertRaises(OperationError):
            self.host.remove("I LOVE VERITY ")

    def test_remove_rechecks_running_instance_identity(self):
        self.docker.compose = lambda *args, **kwargs: json.dumps({"instance_id": "source"})
        self.assertFalse(
            self.host.apply(
                self.request("remove", confirmation="I LOVE VERITY", instance_id="wrong")
            )
        )
        self.assertTrue(
            self.host.apply(
                self.request("remove", confirmation="I LOVE VERITY", instance_id="source")
            )
        )
        self.assertEqual(self.job()["phase"], "removing")

    def test_interrupted_transfer_removes_temporary_password_files(self):
        request = self.request("transfer")
        write_json(self.host.job_path, {**request, "status": "running"})
        directory = self.config.control / "transfers" / request["id"] / "ssh"
        directory.mkdir(parents=True)
        for name in ("password", "askpass"):
            (directory / name).write_text("private")
        self.host.interrupted()
        self.assertFalse((directory / "password").exists())
        self.assertFalse((directory / "askpass").exists())
        self.assertEqual(self.job()["status"], "failed")

    def test_domain_change_preserves_settings_and_updates_ledger(self):
        self.host.apply(self.request("domain", domain="new.example.com", dns_confirmed=True))
        self.assertEqual(self.job()["status"], "succeeded")
        self.assertIn("POSTGRES_PASSWORD=preserve-me", (self.root / ".env").read_text())
        self.assertEqual(read_json(self.engine.ledger)["origin"], "https://new.example.com")

    def test_failed_domain_verification_restores_exact_environment(self):
        original = (self.root / ".env").read_bytes()

        def verify(origin, *args):
            if origin != self.installed["origin"]:
                raise OperationError("New certificate unavailable.")

        self.engine.verifier = verify
        self.host.apply(self.request("domain", domain="new.example.com", dns_confirmed=True))
        self.assertEqual(self.job()["status"], "failed")
        self.assertEqual((self.root / ".env").read_bytes(), original)
        self.assertEqual(read_json(self.engine.ledger), self.installed)

    def test_transfer_waits_for_correct_destination_identity(self):
        class FakeTransfer:
            def __init__(self, *args):
                pass

            def run(self, request, installed, directory, pause, reopen):
                pause()
                reopen()
                return {
                    "destination": installed["origin"],
                    "ip": "1.1.1.1",
                    "instance_id": "destination",
                }

        self.host.transfer_factory = FakeTransfer
        self.host.apply(
            self.request(
                "transfer", ssh_password="never-in-state", owner_password="also-not-in-state"
            )
        )
        self.assertEqual(self.job()["status"], "waiting_dns")
        self.assertTrue(self.config.maintenance.exists())
        self.assertNotIn("never-in-state", self.host.job_path.read_text())
        with patch(
            "noted_updater.host.urlopen", return_value=io.BytesIO(b'{"instance_id":"wrong"}')
        ):
            self.host.poll_transfer()
        self.assertEqual(self.job()["status"], "waiting_dns")
        with patch(
            "noted_updater.host.urlopen",
            side_effect=[
                io.BytesIO(b'{"instance_id":"destination"}'),
                io.BytesIO(b'{"status":"ready"}'),
            ],
        ):
            self.host.poll_transfer()
        self.assertEqual(self.job()["status"], "succeeded")
        self.assertTrue(self.config.maintenance.exists())

    def test_failed_transfer_reopens_source_and_retains_data(self):
        class FailedTransfer:
            def __init__(self, *args):
                pass

            def run(self, request, installed, directory, pause, reopen):
                pause()
                raise OperationError("Remote import failed.")

        self.host.transfer_factory = FailedTransfer
        self.host.apply(self.request("transfer"))
        self.assertEqual(self.job()["status"], "failed")
        self.assertFalse(self.config.maintenance.exists())
        self.assertIn("start-old", self.docker.events)

    def test_cancel_only_applies_to_transfer_waiting_for_dns(self):
        with self.assertRaises(OperationError):
            self.host.apply(self.request("cancel"))
        write_json(
            self.host.job_path, {"id": str(uuid4()), "action": "transfer", "status": "waiting_dns"}
        )
        self.config.maintenance.write_text("paused")
        self.host.apply(self.request("cancel"))
        self.assertEqual(self.job()["status"], "cancelled")
        self.assertFalse(self.config.maintenance.exists())

    def removal_fixture(self):
        self.host.docker = RemovalDocker()
        system = Path(self.temporary.name) / "system"
        system.mkdir()
        unit = system / "noted-updater.service"
        unit.write_text(f"[Service]\nWorkingDirectory={self.root}/updater/code\n")
        return system

    def test_uninstall_preserves_unrelated_files_and_only_removes_private_volumes(self):
        system = self.removal_fixture()
        unrelated = self.root / "unrelated.txt"
        unrelated.write_text("keep me")
        with patch(
            "noted_updater.host.subprocess.run", return_value=subprocess.CompletedProcess([], 0)
        ) as commands:
            self.host.remove("I LOVE VERITY", system)
        self.assertTrue(unrelated.exists())
        self.assertFalse((self.root / ".env").exists())
        self.assertFalse(self.config.control.exists())
        self.assertFalse((system / "noted-updater.service").exists())
        self.assertEqual(
            commands.call_args_list[0].args[0], ["systemctl", "disable", "noted-updater.service"]
        )

    def test_uninstall_rejects_external_or_foreign_volumes(self):
        system = self.removal_fixture()
        for setting in ("external", "foreign", "shared"):
            setattr(self.host.docker, setting, True)
            with (
                patch("noted_updater.host.subprocess.run") as commands,
                self.assertRaises(OperationError),
            ):
                self.host.remove("I LOVE VERITY", system)
            commands.assert_not_called()
            setattr(self.host.docker, setting, False)
        self.assertTrue((self.root / ".env").exists())


class SSHTests(unittest.TestCase):
    def test_ssh_pins_host_key_and_keeps_password_out_of_process_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            connection = SSH(Path(temporary), "1.1.1.1", 22, KEY, "private-password")
            with patch(
                "noted_updater.ssh.subprocess.run",
                return_value=subprocess.CompletedProcess([], 0, b"ok", b""),
            ) as run:
                self.assertEqual(connection.run(["printf", "hello; no shell injection"]), b"ok")
            arguments = run.call_args.args[0]
            self.assertIn("StrictHostKeyChecking=yes", arguments)
            self.assertNotIn("private-password", str(arguments))
            self.assertIn("'hello; no shell injection'", arguments[-1])
            connection.close()
            self.assertFalse(connection.password.exists())

    def test_rejects_invalid_host_keys_and_private_targets(self):
        self.assertTrue(fingerprint(KEY).startswith("SHA256:"))
        for ip in ("127.0.0.1", "169.254.169.254", "10.0.0.1", "::1"):
            with self.assertRaises(OperationError):
                public_ip(ip)
        with self.assertRaises((OperationError, ValueError)):
            fingerprint("ssh-ed25519 " + base64.b64encode(b"invalid").decode())
