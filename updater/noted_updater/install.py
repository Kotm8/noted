import io
import json
import os
import re
import secrets
import sys
from pathlib import Path

from .android_notifications import configure, parse_configuration
from .config import Config
from .docker import Docker, OperationError
from .files import read_json, write_file, write_json
from .release import Manifest
from .remote import finish
from .worker import process_lock

OWNER_SCRIPT = """import sys
from sqlalchemy.orm import Session
from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.core.config import Settings
from app.core.security import verify_password
from app.db.database import create_database_engine
credentials = LoginRequest.model_validate_json(sys.stdin.buffer.read(4097))
engine = create_database_engine(Settings().database_url)
with Session(engine) as db:
    service = AuthService(db)
    if service.is_setup_required():
        service.provision_owner(credentials)
    else:
        owner = service.users.get_by_username(credentials.username)
        if owner is None or not verify_password(
            credentials.password.get_secret_value(), owner.password_hash
        ):
            raise SystemExit('An existing owner has different credentials; nothing was replaced.')
engine.dispose()
"""


class Installer:
    def __init__(self, root: Path, data: dict, phase, docker=None, finisher=finish):
        self.root, self.data, self.phase, self.finisher = root, data, phase, finisher
        self.manifest = Manifest.parse(data["release"], data["repository"])
        self.docker = docker or Docker(Config(root, data["repository"]))
        self.deployment = {"compose": str(root / "compose.production.yaml")}

    def validate(self) -> dict:
        data = self.data
        if not re.fullmatch(r"[a-f0-9]{64}", data["setup_id"]):
            raise OperationError("Invalid installation identity.")
        if (self.root / ".setup-id").read_text() != data["setup_id"]:
            raise OperationError("This installation belongs to another setup.")
        domain = data["domain"]
        if len(domain) > 253 or not re.fullmatch(
            r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain
        ):
            raise OperationError("Invalid domain.")
        if not 1 <= len(data["server_name"]) <= 80 or any(
            ord(char) < 32 for char in data["server_name"]
        ):
            raise OperationError("Invalid server name.")
        if not re.fullmatch(r"[\w.\- ]{1,64}", data["username"]):
            raise OperationError("Invalid owner username.")
        if not 12 <= len(data["password"]) <= 256:
            raise OperationError("Use an owner password of 12 to 256 characters.")
        identity = {
            key: data[key]
            for key in ("setup_id", "repository", "domain", "server_name", "username")
        }
        identity["commit"] = self.manifest.commit
        path = self.root / ".setup.json"
        if path.exists() and read_json(path) != identity:
            raise OperationError("Retry with the same server details and release.")
        return identity

    def run(self) -> None:
        identity = self.validate()
        android_notifications = parse_configuration(self.data.get("android_notifications"))
        installed = self.root / "updater/installed.json"
        if installed.exists():
            if read_json(installed)["commit"] != self.manifest.commit:
                raise OperationError("The server has been updated. Connect to the existing server.")
            configure(self.docker, self.deployment, android_notifications, self.phase)
            self.phase("updater", "Checking the installed update service.")
            self.finisher(self.data["repository"])
            self.phase("installed", "Noted is installed. Checking your domain and HTTPS next.")
            return
        write_json(self.root / ".setup.json", identity)
        environment = self.root / ".env"
        if not environment.exists():
            values = {
                "POSTGRES_PASSWORD": secrets.token_hex(32),
                "NOTED_DOMAIN": self.data["domain"],
                "NOTED_SERVER_NAME": self.data["server_name"],
                "NOTED_BACKEND_IMAGE": self.manifest.backend_image,
                "NOTED_WEB_IMAGE": self.manifest.web_image,
                "NOTED_INSTANCE_ID": secrets.token_hex(16),
            }
            write_file(
                environment,
                "".join(
                    f"{key}={json.dumps(value, ensure_ascii=False).replace('$', '$$')}\n"
                    for key, value in values.items()
                ).encode(),
            )
        for name in ("state", "requests", "maintenance"):
            path = self.root / "updater" / name
            path.mkdir(parents=True, exist_ok=True)
            path.chmod(0o770 if name == "requests" else 0o755)
        if os.name != "nt":
            os.chown(self.root / "updater/requests", 1000, 1000)
        self.phase("images", "Downloading the published server images on the VPS.")
        for image in (self.manifest.backend_image, self.manifest.web_image, "postgres:18.4-alpine"):
            self.docker.ensure_image(image)
        self.phase("starting", "Starting PostgreSQL, applying migrations, and starting Noted.")
        self.docker.compose(
            self.deployment,
            ["up", "-d", "--wait", "--wait-timeout", "180"],
            "Server startup",
            timeout=600,
        )
        self.phase("owner", "Creating your owner account.")
        credentials = json.dumps(
            {"username": self.data["username"], "password": self.data["password"]}
        ).encode()
        self.docker.compose(
            self.deployment,
            ["exec", "-T", "backend", "python", "-c", OWNER_SCRIPT],
            "Owner account provisioning",
            input_file=io.BytesIO(credentials),
        )
        configure(self.docker, self.deployment, android_notifications, self.phase)
        self.phase("updater", "Enabling daily update checks and click-to-install upgrades.")
        self.finisher(self.data["repository"])
        self.phase("installed", "Noted is installed. Checking your domain and HTTPS next.")


def report(phase: str, detail: str) -> None:
    print("NOTED_SETUP " + json.dumps({"phase": phase, "detail": detail}), flush=True)


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(262145)
        if len(raw) > 262144:
            raise ValueError("Setup request is too large")
        data = json.loads(raw)
        root = Path("/opt/noted")
        with process_lock(root / ".setup.lock"):
            Installer(root, data, report).run()
    except (OperationError, ValueError, KeyError, OSError):
        report(
            "error", "Server setup stopped. Check the current step and retry with the same details."
        )
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
