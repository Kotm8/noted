import json
import logging
import os
import re
import tempfile
import threading
from dataclasses import dataclass, field
from functools import partial
from importlib import import_module
from pathlib import Path
from typing import Any, Literal

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.core.errors import ValidationError

logger = logging.getLogger(__name__)


class FirebaseClient(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str = Field(pattern=r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
    application_id: str = Field(pattern=r"^1:\d+:android:[a-f0-9]+$", max_length=150)
    sender_id: str = Field(pattern=r"^\d{1,30}$")
    api_key: str = Field(pattern=r"^AIza[\w-]{35}$")
    package_name: Literal["com.noted.android"] = "com.noted.android"


class FirebaseInput(BaseModel):
    googleServicesJson: str = Field(max_length=32768)
    serviceAccountJson: SecretStr = Field(max_length=32768)


@dataclass
class FirebaseConfiguration:
    client: FirebaseClient
    account: dict[str, str] = field(repr=False)


def configuration_path(storage: Path) -> Path:
    return storage / ".server" / "firebase.json"


def validate_configuration(value: dict[str, Any]) -> FirebaseConfiguration:
    try:
        client = FirebaseClient.model_validate(value["client"])
        account = value["service_account"]
        if (
            account["type"] != "service_account"
            or account["project_id"] != client.project_id
            or not account["client_email"].endswith(f"@{client.project_id}.iam.gserviceaccount.com")
            or account["token_uri"] != "https://oauth2.googleapis.com/token"
            or client.application_id.split(":")[1] != client.sender_id
        ):
            raise ValueError
        key = serialization.load_pem_private_key(account["private_key"].encode(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
            raise ValueError
        return FirebaseConfiguration(
            client,
            {
                name: account[name]
                for name in ("type", "project_id", "client_email", "private_key", "token_uri")
            }
            | {"private_key_id": str(account.get("private_key_id", ""))},
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValidationError(
            "Use complete Firebase JSON files from the same project and a valid RSA private key."
        ) from None


def parse_configuration(data: FirebaseInput) -> FirebaseConfiguration:
    try:
        services = json.loads(data.googleServicesJson)
        account = json.loads(data.serviceAccountJson.get_secret_value())
        info = services["project_info"]
        app = next(
            app
            for app in services["client"]
            if app["client_info"]["android_client_info"]["package_name"] == "com.noted.android"
        )
        api_key = next(
            key["current_key"]
            for key in app["api_key"]
            if re.fullmatch(r"AIza[\w-]{35}", key.get("current_key", ""))
        )
        return validate_configuration(
            {
                "client": {
                    "project_id": info["project_id"],
                    "sender_id": str(info["project_number"]),
                    "application_id": app["client_info"]["mobilesdk_app_id"],
                    "api_key": api_key,
                },
                "service_account": account,
            }
        )
    except (KeyError, TypeError, ValueError, AttributeError, StopIteration):
        raise ValidationError(
            "Import complete google-services.json and service-account JSON for com.noted.android."
        ) from None


def load_configuration(storage: Path) -> FirebaseConfiguration | None:
    path = configuration_path(storage)
    if not path.exists():
        return None
    try:
        with path.open("rb") as file:
            raw = file.read(65537)
        if len(raw) > 65536:
            raise ValueError
        value = json.loads(raw)
        return validate_configuration(value)
    except (OSError, ValueError):
        raise ValidationError(
            "The saved Firebase configuration could not be read. Import both JSON files again."
        ) from None


def save_configuration(storage: Path, data: FirebaseInput) -> FirebaseClient:
    configuration = parse_configuration(data)
    path = configuration_path(storage)
    if path.parent.is_symlink():
        raise ValidationError("The server configuration directory must not be a symbolic link.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=".firebase-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            json.dump(
                {
                    "client": configuration.client.model_dump(),
                    "service_account": configuration.account,
                },
                file,
            )
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return configuration.client


_lock = threading.Lock()
_credentials: tuple[str, Any] | None = None


def access_token(configuration: FirebaseConfiguration) -> str:
    from app.core.security import hash_token

    global _credentials
    identity = hash_token(json.dumps(configuration.account, sort_keys=True))
    with _lock:
        if _credentials is None or _credentials[0] != identity:
            service_account = import_module("google.oauth2.service_account")
            credentials = service_account.Credentials.from_service_account_info(
                configuration.account, scopes=["https://www.googleapis.com/auth/firebase.messaging"]
            )
            _credentials = (identity, credentials)
        credentials = _credentials[1]
        if not credentials.valid:
            transport = import_module("google.auth.transport.requests")
            credentials.refresh(partial(transport.Request(), timeout=10))
        return str(credentials.token)


def send_firebase(
    endpoint: str, storage: Path, origin: str, payload: str, ttl: int
) -> Literal["accepted", "expired", "failed"]:
    requests = import_module("requests")
    auth_errors = import_module("google.auth.exceptions")
    try:
        configuration = load_configuration(storage)
        if configuration is None:
            return "failed"
        _, project, token = endpoint.split(":", 2)
        if project != configuration.client.project_id:
            return "expired"
        response = requests.post(
            f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
            headers={"Authorization": f"Bearer {access_token(configuration)}"},
            json={
                "message": {
                    "token": token,
                    "data": {"payload": payload, "origin": origin, "project": project},
                    "android": {
                        "priority": "HIGH",
                        "ttl": f"{ttl}s",
                        "restricted_package_name": "com.noted.android",
                    },
                }
            },
            timeout=10,
        )
        if response.status_code == 200:
            return "accepted"
        error = response.json().get("error", {})
        if not isinstance(error, dict) or not isinstance(error.get("details", []), list):
            return "failed"
        codes = {
            detail.get("errorCode")
            for detail in error.get("details", [])
            if isinstance(detail, dict)
        }
        if codes & {"UNREGISTERED", "SENDER_ID_MISMATCH"}:
            return "expired"
    except (
        ValidationError,
        ValueError,
        AttributeError,
        OSError,
        requests.RequestException,
        auth_errors.GoogleAuthError,
    ):
        logger.warning(
            "Android push delivery failed; check Firebase configuration and connectivity."
        )
    return "failed"
