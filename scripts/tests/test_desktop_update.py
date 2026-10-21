import base64
import unittest

from scripts.desktop_update import verify_signature
from scripts.tests.signing_fixture import sign


class DesktopSignatureTests(unittest.TestCase):
    def test_rejects_tampering_wrong_keys_and_announced_versions(self):
        data = b"signed Windows installer"
        key, signature = sign(data, "0.2.2")
        verify_signature(data, signature, key, "0.2.2")
        other_key, _ = sign(data, "0.2.2")
        tampered_comment = base64.b64encode(
            base64.b64decode(signature).replace(b"version:0.2.2", b"version:9.9.9")
        ).decode()
        for body, sig, public, version in [
            (data + b"changed", signature, key, "0.2.2"),
            (data, signature, other_key, "0.2.2"),
            (data, signature, key, "9.9.9"),
            (data, tampered_comment, key, "9.9.9"),
            (data, "not-a-signature", key, "0.2.2"),
        ]:
            with self.subTest(version=version, body=body):
                with self.assertRaises(ValueError):
                    verify_signature(body, sig, public, version)
