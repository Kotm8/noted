import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.config import Config
from noted_updater.engine import Engine, verify_http
from noted_updater.files import read_json, write_json
from noted_updater.host import Host


class VerificationHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("User-Agent") != "Noted-server-updater":
            self.send_error(403)
            return
        if self.path == "/api/v1/health/ready":
            data = {"status": "ready"}
        elif self.path == "/api/v1/version":
            data = {
                "build_commit": "a" * 40,
                "schema_revision": "0007_reminders",
                "version": "0.1.0",
                "instance_id": "expected-instance",
            }
        else:
            self.send_error(404)
            return
        content = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *arguments):
        pass


class PublicVerificationTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), VerificationHandler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(self.server.shutdown)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def test_update_verification_identifies_itself_to_the_proxy(self):
        clock = iter((0, 0, 121))
        with patch(
            "noted_updater.engine.time",
            SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda seconds: None),
        ):
            verify_http(self.origin, "a" * 40, "0007_reminders", "0.1.0")

    def test_transfer_verification_identifies_itself_and_checks_the_instance(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Config(Path(directory), "owner/noted")
            host = Host(config, Engine(config, None))
            job = {"status": "waiting_dns", "destination": self.origin, "instance_id": "wrong"}
            write_json(host.job_path, job)
            host.poll_transfer()
            self.assertEqual(read_json(host.job_path)["status"], "waiting_dns")
            job["instance_id"] = "expected-instance"
            write_json(host.job_path, job)
            host.poll_transfer()
            self.assertEqual(read_json(host.job_path)["status"], "succeeded")
