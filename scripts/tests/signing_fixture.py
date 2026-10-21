import base64
import hashlib

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def sign(data: bytes, version: str) -> tuple[str, str]:
    private = Ed25519PrivateKey.generate()
    key_id = b"test-key"
    public = b"Ed" + key_id + private.public_key().public_bytes_raw()
    key_text = "untrusted comment: test public key\n" + base64.b64encode(public).decode()
    signature = private.sign(hashlib.blake2b(data).digest())
    comment = f"timestamp:1700000000\tfile:test.exe\tversion:{version}"
    global_signature = private.sign(signature + comment.encode())
    text = "\n".join(
        [
            "untrusted comment: test signature",
            base64.b64encode(b"ED" + key_id + signature).decode(),
            "trusted comment: " + comment,
            base64.b64encode(global_signature).decode(),
        ]
    )
    return base64.b64encode(key_text.encode()).decode(), base64.b64encode(text.encode()).decode()
