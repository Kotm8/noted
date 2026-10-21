import base64
import binascii
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[1]


def public_key() -> str:
    config = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text())
    return config["plugins"]["updater"]["pubkey"]


def verify_signature(data: bytes, signature: str, key: str, version: str) -> None:
    try:
        key_lines = base64.b64decode(key, validate=True).decode().splitlines()
        key_bytes = base64.b64decode(key_lines[1], validate=True)
        lines = base64.b64decode(signature, validate=True).decode().splitlines()
        signature_bytes = base64.b64decode(lines[1], validate=True)
        global_signature = base64.b64decode(lines[3], validate=True)
        if (
            len(key_bytes) != 42
            or key_bytes[:2] != b"Ed"
            or len(signature_bytes) != 74
            or signature_bytes[:2] not in {b"ED", b"Ed"}
            or signature_bytes[2:10] != key_bytes[2:10]
            or not lines[2].startswith("trusted comment: ")
        ):
            raise ValueError("Invalid desktop signature format or signing key.")
        comment = lines[2].removeprefix("trusted comment: ")
        versions = [
            field.removeprefix("version:")
            for field in comment.split("\t")
            if field.startswith("version:")
        ]
        if versions != [version]:
            raise ValueError("The desktop signature is not bound to this release version.")
        payload = hashlib.blake2b(data).digest() if signature_bytes[:2] == b"ED" else data
        verifier = Ed25519PublicKey.from_public_bytes(key_bytes[10:])
        verifier.verify(signature_bytes[10:], payload)
        verifier.verify(global_signature, signature_bytes[10:] + comment.encode())
    except (InvalidSignature, binascii.Error, IndexError, UnicodeError) as error:
        raise ValueError("The Windows installer signature did not verify.") from error


def manifest(installer: Path, version: str, repository: str, commit: str, notes: str) -> bytes:
    signature = installer.with_suffix(".exe.sig").read_text().strip()
    verify_signature(installer.read_bytes(), signature, public_key(), version)
    expected_name = f"Noted_{version}_x64-setup.exe"
    if installer.name != expected_name:
        raise ValueError("The Windows installer filename does not match the release version.")
    return json.dumps(
        {
            "version": version,
            "notes": notes,
            "pub_date": datetime.now(UTC).isoformat(),
            "platforms": {
                "windows-x86_64": {
                    "signature": signature,
                    "url": f"https://github.com/{repository}/releases/download/main-{commit}/{installer.name}",
                }
            },
        },
        indent=2,
    ).encode()
