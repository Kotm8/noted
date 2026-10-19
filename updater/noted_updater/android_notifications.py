import io
import json
import re

from .docker import OperationError

CONFIGURE_SCRIPT = """import json
import os
import sys
import tempfile
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from app.core.config import Settings
data = json.load(sys.stdin)
try:
    key = serialization.load_pem_private_key(
        data['service_account']['private_key'].encode(), password=None
    )
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise ValueError('Invalid key')
except (ValueError, TypeError):
    raise SystemExit('Use a valid RSA service-account private key from Firebase.') from None
directory = Settings().storage_path / '.server'
if directory.is_symlink():
    raise SystemExit('The server configuration directory must not be a symbolic link.')
directory.mkdir(mode=0o700, parents=True, exist_ok=True)
directory.chmod(0o700)
descriptor, temporary = tempfile.mkstemp(prefix='.firebase-', dir=directory)
try:
    with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
        json.dump(data, file)
        file.flush()
        os.fsync(file.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, directory / 'firebase.json')
finally:
    Path(temporary).unlink(missing_ok=True)
"""


def parse_configuration(value: object) -> dict | None:
    if value is None:
        return None
    try:
        if not isinstance(value, dict):
            raise ValueError
        documents = []
        for name in ("googleServicesJson", "serviceAccountJson"):
            raw = value[name]
            if not isinstance(raw, str) or len(raw.encode()) > 32768:
                raise ValueError
            document = json.loads(raw)
            if not isinstance(document, dict):
                raise ValueError
            documents.append(document)
        services, account = documents
        project = services["project_info"]
        project_id = project["project_id"]
        sender_id = str(project["project_number"])
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project_id):
            raise ValueError
        if not re.fullmatch(r"\d{1,30}", sender_id):
            raise ValueError
        client = next(
            app
            for app in services["client"]
            if app.get("client_info", {}).get("android_client_info", {}).get("package_name")
            == "com.noted.android"
        )
        application_id = client["client_info"]["mobilesdk_app_id"]
        if not re.fullmatch(rf"1:{sender_id}:android:[a-f0-9]+", application_id):
            raise ValueError
        api_key = next(
            entry["current_key"]
            for entry in client["api_key"]
            if re.fullmatch(r"AIza[\w-]{35}", entry.get("current_key", ""))
        )
        if (
            account["type"] != "service_account"
            or account["project_id"] != project_id
            or not account["client_email"].endswith(f"@{project_id}.iam.gserviceaccount.com")
            or account["token_uri"] != "https://oauth2.googleapis.com/token"
            or not account["private_key"].startswith("-----BEGIN PRIVATE KEY-----\n")
            or not account["private_key"].rstrip().endswith("-----END PRIVATE KEY-----")
        ):
            raise ValueError
        return {
            "client": {
                "project_id": project_id,
                "application_id": application_id,
                "sender_id": sender_id,
                "api_key": api_key,
                "package_name": "com.noted.android",
            },
            "service_account": {
                "type": "service_account",
                "project_id": project_id,
                "client_email": account["client_email"],
                "private_key": account["private_key"],
                "private_key_id": str(account.get("private_key_id", "")),
                "token_uri": "https://oauth2.googleapis.com/token",
            },
        }
    except (KeyError, TypeError, ValueError, AttributeError, StopIteration):
        raise OperationError(
            "Check both Firebase JSON files: use com.noted.android and the same project."
        ) from None


def configure(docker, deployment: dict, configuration: dict | None, phase) -> None:
    if configuration is None:
        return
    phase("android_notifications", "Saving Firebase configuration privately on your VPS.")
    docker.compose(
        deployment,
        ["exec", "-T", "backend", "python", "-c", CONFIGURE_SCRIPT],
        "Android notification configuration",
        input_file=io.BytesIO(json.dumps(configuration).encode()),
    )
