import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import desktop


class DesktopSigningTests(unittest.TestCase):
    def test_normalizes_wrapped_and_trailing_whitespace(self):
        key = base64.b64encode(b"untrusted comment: fixture\nprivate fixture").decode()
        value = key[:20] + "\r\n" + key[20:] + "\n"
        with patch.dict(os.environ, {"TAURI_SIGNING_PRIVATE_KEY": value}, clear=True):
            environment = desktop.signing_environment()
        self.assertEqual(environment["TAURI_SIGNING_PRIVATE_KEY"], key)
        self.assertEqual(environment["TAURI_SIGNING_PRIVATE_KEY_PASSWORD"], "")

    def test_reads_existing_key_paths(self):
        key = base64.b64encode(b"untrusted comment: fixture\nprivate fixture").decode()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "updater.key"
            path.write_text(key + "\n")
            with patch.dict(os.environ, {"TAURI_SIGNING_PRIVATE_KEY": str(path)}, clear=True):
                self.assertEqual(desktop.signing_environment()["TAURI_SIGNING_PRIVATE_KEY"], key)

    def test_rejects_invalid_keys_without_echoing_the_value(self):
        for value in ("invalid-private-value", base64.b64encode(b"wrong format").decode()):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"TAURI_SIGNING_PRIVATE_KEY": value}, clear=True):
                    with self.assertRaises(SystemExit) as caught:
                        desktop.signing_environment()
                self.assertNotIn(value, str(caught.exception))

    def test_signs_existing_installer_without_building(self):
        with tempfile.TemporaryDirectory() as directory:
            installer = Path(directory) / "Noted_0.2.2_x64-setup.exe"
            installer.write_bytes(b"installer fixture")
            config = Path(directory) / "tauri.conf.json"
            config.write_text('{"version":"0.2.2"}')
            with (
                patch.object(desktop, "CONFIG", config),
                patch.object(sys, "argv", ["desktop.py", "sign", "--installer", str(installer)]),
                patch.object(desktop, "signing_environment", return_value={}),
                patch.object(desktop, "tauri") as tauri,
                patch.object(desktop, "verify_installer") as verify,
            ):
                desktop.main()
            tauri.assert_called_once_with(
                "signer", "sign", "--app-version", "0.2.2", str(installer.resolve()), environment={}
            )
            verify.assert_called_once_with(installer.resolve(), "0.2.2")


if __name__ == "__main__":
    unittest.main()
