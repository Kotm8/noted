import hashlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from noted_updater.config import Config
from noted_updater.docker import Docker


class DockerInputTests(unittest.TestCase):
    def setUp(self):
        self.docker = Docker(Config(Path("."), "owner/noted"))
        run = subprocess.run

        def process(arguments, **options):
            self.assertEqual(arguments[0], "docker")
            return run([sys.executable, *arguments[1:]], **options)

        self.enterContext(patch("noted_updater.docker.subprocess.run", side_effect=process))
        self.arguments = [
            "-c",
            "import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())",
        ]

    def test_credentials_reach_a_real_process_through_stdin(self):
        credentials = b'{"username":"owner","password":"test-only-private-password"}'
        stream = io.BytesIO(b"ignored prefix" + credentials)
        stream.seek(len(b"ignored prefix"))
        result = self.docker.run(self.arguments, "Owner provisioning", input_file=stream)
        self.assertEqual(result.strip(), hashlib.sha256(credentials).hexdigest())

    def test_file_input_still_streams_to_the_process(self):
        content = b"backup contents" * 10000
        with tempfile.TemporaryFile() as stream:
            stream.write(content)
            stream.seek(0)
            result = self.docker.run(self.arguments, "Backup import", input_file=stream)
        self.assertEqual(result.strip(), hashlib.sha256(content).hexdigest())
