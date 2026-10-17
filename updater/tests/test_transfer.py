import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.config import Config
from noted_updater.docker import OperationError
from noted_updater.transfer import Transfer


class TransferDocker:
    def __init__(self, root):
        self.root = root
        self.events = []

    def required_space(self, installed):
        return 1

    def resolved(self, installed):
        return {
            "services": {
                "backend": {"environment": {"NOTED_SERVER_NAME": "My notes"}},
                "web": {
                    "volumes": [
                        {
                            "target": "/etc/caddy/Caddyfile",
                            "source": str(self.root / "Caddyfile.production"),
                        }
                    ]
                },
            }
        }

    def running_image(self, installed, name):
        return "sha256:" + ("a" if name == "backend" else "b") * 64

    def run(self, arguments, label, **options):
        self.events.append("images")
        options["output"].write(b"fixture images")

    def compose(self, installed, arguments, label, **options):
        self.events.append("export")
        options["output"].write(b"portable content fixture")


class TransferTests(unittest.TestCase):
    def test_automatic_transfer_orders_setup_snapshot_import_and_scrubs_secrets(self):
        self.run_transfer(False)

    def test_failed_import_closes_ssh_without_deleting_source_or_destination(self):
        self.run_transfer(True)

    def run_transfer(self, fail_import):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "Caddyfile.production").write_text("fixture")
            (root / "compose.production.yaml").write_text("fixture")
            docker = TransferDocker(root)
            events = docker.events
            captured = {}

            class Connection:
                def __init__(self, *args):
                    captured["closed"] = False

                def run(self, arguments, input_file=None, **options):
                    if arguments == ["sh", "-s"]:
                        events.append("provision")
                    if "initialise" in arguments:
                        captured["settings"] = json.load(input_file)
                        events.append("start-destination")
                    if "create-owner" in arguments:
                        captured["owner"] = json.load(input_file)
                        events.append("owner")
                    if "import" in arguments:
                        events.append("import")
                        if fail_import:
                            raise OperationError("Import failed.")
                        self.asserted_input = input_file.read()
                    if "-c" in arguments:
                        return json.dumps(
                            {
                                "instance_id": captured["settings"]["instance_id"],
                                "build_commit": "c" * 40,
                                "schema_revision": "0003_attachment_order",
                            }
                        ).encode()
                    if "finish" in arguments:
                        events.append("worker")
                    return b""

                def close(self):
                    captured["closed"] = True

            transfer = Transfer(
                Config(root, "owner/noted"), docker, lambda *args: None, ssh_factory=Connection
            )
            request = {
                "ssh_user": "root",
                "pause_confirmed": True,
                "ip": "1.1.1.1",
                "port": 22,
                "host_key": "fixture",
                "ssh_password": "private-ssh",
                "owner_username": "destination-owner",
                "owner_password": "private-owner-password",
            }
            installed = {
                "compose": str(root / "compose.production.yaml"),
                "origin": "https://notes.example.com",
                "commit": "c" * 40,
                "schema": "0003_attachment_order",
            }
            work = root / "transfer"
            work.mkdir()
            if fail_import:
                with self.assertRaises(OperationError):
                    transfer.run(
                        request,
                        installed,
                        work,
                        lambda: events.append("pause"),
                        lambda: events.append("reopen"),
                    )
                self.assertNotIn("reopen", events)
            else:
                result = transfer.run(
                    request,
                    installed,
                    work,
                    lambda: events.append("pause"),
                    lambda: events.append("reopen"),
                )
                self.assertEqual(result["destination"], "https://notes.example.com")
                self.assertEqual(
                    events,
                    [
                        "provision",
                        "images",
                        "start-destination",
                        "owner",
                        "pause",
                        "export",
                        "import",
                        "worker",
                        "reopen",
                    ],
                )
                receipt = (work / "receipt.json").read_text()
                self.assertNotIn("private-ssh", receipt)
                self.assertNotIn("private-owner-password", receipt)
            self.assertTrue(captured["closed"])
            self.assertEqual(captured["owner"]["username"], "destination-owner")
            self.assertTrue((root / "compose.production.yaml").exists())
