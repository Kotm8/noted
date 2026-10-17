import io
import json
import secrets
import shutil
import tarfile
from pathlib import Path
from uuid import uuid4

from .docker import Docker, OperationError
from .files import write_file
from .ssh import SSH

REMOTE = "/opt/noted"


class Transfer:
    def __init__(self, config, docker: Docker, phase, ssh_factory=SSH):
        self.config, self.docker, self.phase = config, docker, phase
        self.ssh_factory = ssh_factory

    def bundle(self, installed: dict, directory: Path) -> Path:
        resolved = self.docker.resolved(installed)
        proxy = next(
            mount["source"]
            for mount in resolved["services"]["web"]["volumes"]
            if mount["target"] == "/etc/caddy/Caddyfile"
        )
        target = directory / "deployment.tar"
        with tarfile.open(target, "w") as archive:
            archive.add(installed["compose"], arcname="compose.production.yaml")
            archive.add(proxy, arcname="Caddyfile.production")
            package = Path(__file__).resolve().parent
            for file in sorted(package.rglob("*")):
                if file.is_file() and file.suffix in {".py", ".sh"}:
                    archive.add(
                        file,
                        arcname=f"updater/code/noted_updater/{file.relative_to(package).as_posix()}",
                    )
        return target

    def run(self, request: dict, installed: dict, directory: Path, pause, reopen) -> dict:
        if request.get("ssh_user") != "root" or request.get("pause_confirmed") is not True:
            raise OperationError(
                "Confirm that this transfer may pause writes and uses root SSH access."
            )
        if (
            shutil.disk_usage(self.config.directory).free
            < self.docker.required_space(installed) + 1073741824
        ):
            raise OperationError(
                "Free at least 1 GB beyond the backup requirement before transferring."
            )
        connection = self.ssh_factory(
            directory / "ssh",
            request["ip"],
            request["port"],
            request["host_key"],
            request["ssh_password"],
        )
        try:
            self.phase(
                "provisioning",
                "Verifying and preparing the destination. The current server remains available.",
            )
            script = Path(__file__).parent / "resources/provision.sh"
            with script.open("rb") as file:
                connection.run(["sh", "-s"], input_file=file, timeout=1800)
            deployment = self.bundle(installed, directory)
            with deployment.open("rb") as file:
                connection.run(["tar", "-xf", "-", "-C", REMOTE], input_file=file)
            self.phase("images", "Copying the installed application images to the new VPS.")
            images = {
                name: self.docker.running_image(installed, name) for name in ("backend", "web")
            }
            image_archive = directory / "images.tar"
            with image_archive.open("wb") as file:
                self.docker.run(
                    ["save", images["backend"], images["web"]],
                    "Transfer image archive",
                    timeout=1800,
                    output=file,
                )
            with image_archive.open("rb") as file:
                connection.run(["docker", "load"], input_file=file, timeout=1800)
            image_archive.unlink()
            environment = self.docker.resolved(installed)["services"]["backend"]["environment"]
            instance_id = uuid4().hex
            data = {
                "repository": self.config.repository,
                "domain": installed["origin"].removeprefix("https://"),
                "server_name": environment["NOTED_SERVER_NAME"],
                "backend_image": images["backend"],
                "web_image": images["web"],
                "database_password": secrets.token_hex(32),
                "instance_id": instance_id,
            }
            remote_command = [
                "env",
                f"PYTHONPATH={REMOTE}/updater/code",
                "python3",
                "-m",
                "noted_updater.remote",
            ]
            connection.run(
                [*remote_command, "initialise"],
                input_file=io.BytesIO(json.dumps(data).encode()),
                timeout=300,
            )
            compose = [
                "docker",
                "compose",
                "--project-name",
                "noted",
                "--project-directory",
                REMOTE,
                "--env-file",
                f"{REMOTE}/.env",
                "-f",
                f"{REMOTE}/compose.production.yaml",
            ]
            self.phase(
                "owner",
                "Creating the destination owner. "
                "Sign-in credentials stay outside the content backup.",
            )
            owner = json.dumps(
                {"username": request["owner_username"], "password": request["owner_password"]}
            ).encode()
            connection.run(
                [
                    *compose,
                    "exec",
                    "-T",
                    "backend",
                    "python",
                    "-m",
                    "app.cli",
                    "create-owner",
                    "--stdin",
                ],
                input_file=io.BytesIO(owner),
            )
            self.phase("snapshot", "Pausing writes and exporting a consistent content backup.")
            pause()
            archive = directory / "content.zip"
            with archive.open("wb") as file:
                self.docker.compose(
                    installed,
                    [
                        "run",
                        "--rm",
                        "--no-deps",
                        "-T",
                        "--pull",
                        "never",
                        "--entrypoint",
                        "python",
                        "backend",
                        "-m",
                        "app.portability",
                        "export",
                    ],
                    "Portable transfer backup",
                    timeout=1800,
                    output=file,
                )
            self.phase(
                "importing", "Importing projects, channels, messages, and files on the new VPS."
            )
            connection.run(
                [
                    "python3",
                    "-c",
                    "import shutil, sys; assert shutil.disk_usage('/opt/noted').free > "
                    "int(sys.argv[1]) * 3 + 268435456, 'Insufficient destination disk space'",
                    str(archive.stat().st_size),
                ]
            )
            with archive.open("rb") as file:
                connection.run(
                    [
                        *compose,
                        "exec",
                        "-T",
                        "backend",
                        "python",
                        "-m",
                        "app.portability",
                        "import",
                    ],
                    input_file=file,
                    timeout=1800,
                )
            version = json.loads(
                connection.run(
                    [
                        *compose,
                        "exec",
                        "-T",
                        "backend",
                        "python",
                        "-c",
                        "import json, urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/v1/version').read().decode())",
                    ]
                )
            )
            if (
                version.get("instance_id") != instance_id
                or version.get("build_commit", "development") != installed["commit"]
                or version.get("schema_revision") != installed["schema"]
            ):
                raise OperationError(
                    "The destination did not report the expected installation identity."
                )
            connection.run(
                [*remote_command, "finish"],
                input_file=io.BytesIO(json.dumps({"repository": self.config.repository}).encode()),
            )
            receipt = {
                "destination": installed["origin"],
                "ip": request["ip"],
                "instance_id": instance_id,
                "backup": str(archive),
            }
            write_file(directory / "receipt.json", json.dumps(receipt).encode())
            reopen()
            return receipt
        finally:
            connection.close()
