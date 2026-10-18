import io
import json
import subprocess
from pathlib import Path
from typing import Any, BinaryIO

from .config import Config


class OperationError(Exception):
    pass


class Docker:
    def __init__(self, config: Config):
        self.config = config

    def run(
        self,
        arguments: list[str],
        label: str,
        timeout: int = 300,
        output: BinaryIO | None = None,
        input_file: BinaryIO | None = None,
    ) -> str:
        try:
            payload = input_file.read() if isinstance(input_file, io.BytesIO) else None
            result = subprocess.run(
                ["docker", *arguments],
                stdin=None if payload is not None else input_file or subprocess.DEVNULL,
                input=payload,
                stdout=output or subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise OperationError(f"{label} did not complete.") from None
        if result.returncode:
            raise OperationError(f"{label} failed.")
        return result.stdout.decode("utf-8") if output is None else ""

    def compose(
        self, deployment: dict[str, Any], arguments: list[str], label: str, **kwargs
    ) -> str:
        command = [
            "compose",
            "--project-name",
            self.config.project,
            "--project-directory",
            str(self.config.directory),
            "--env-file",
            str(self.config.directory / ".env"),
        ]
        if deployment.get("env"):
            command.extend(["--env-file", deployment["env"]])
        command.extend(["-f", deployment["compose"], *arguments])
        return self.run(command, label, **kwargs)

    def resolved(self, deployment: dict[str, Any]) -> dict[str, Any]:
        return json.loads(
            self.compose(deployment, ["config", "--format", "json"], "Deployment validation")
        )

    def schema(self, deployment: dict[str, Any]) -> str:
        return self.compose(
            deployment,
            [
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "noted",
                "-d",
                "noted",
                "-Atc",
                "SELECT version_num FROM alembic_version",
            ],
            "Schema inspection",
        ).strip()

    def running_image(self, deployment: dict[str, Any], service: str) -> str:
        identifier = self.compose(
            deployment, ["ps", "-q", service], "Installed container inspection"
        ).strip()
        if not identifier:
            raise OperationError("The installed stack is not running.")
        return self.run(
            ["inspect", "--format", "{{.Image}}", identifier], "Installed image inspection"
        ).strip()

    def ensure_image(self, image: str) -> None:
        try:
            self.run(["image", "inspect", image], "Cached image inspection")
        except OperationError:
            self.run(["pull", image], "Image download", timeout=1800)

    def start(self, deployment: dict[str, Any]) -> None:
        self.compose(
            deployment,
            [
                "up",
                "-d",
                "--no-deps",
                "--pull",
                "never",
                "--wait",
                "--wait-timeout",
                "120",
                "backend",
                "web",
            ],
            "Application restart",
            timeout=180,
        )

    def backup(self, deployment: dict[str, Any], directory: Path) -> None:
        directory.mkdir(mode=0o700, parents=True, exist_ok=False)
        database = directory / "database.dump"
        attachments = directory / "attachments.tar"
        for path in (database, attachments):
            with path.open("xb"):
                pass
            path.chmod(0o600)
        with database.open("wb") as file:
            self.compose(
                deployment,
                ["exec", "-T", "db", "pg_dump", "-U", "noted", "-d", "noted", "--format=custom"],
                "Database backup",
                timeout=1800,
                output=file,
            )
        with database.open("rb") as file:
            self.compose(
                deployment,
                ["exec", "-T", "db", "pg_restore", "--list"],
                "Database backup validation",
                input_file=file,
            )
        script = (
            "import sys, tarfile; "
            "archive = tarfile.open(fileobj=sys.stdout.buffer, mode='w|'); "
            "archive.add('/data/attachments', arcname='attachments'); archive.close()"
        )
        with attachments.open("wb") as file:
            self.compose(
                deployment,
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
                    "-c",
                    script,
                ],
                "Attachment backup",
                timeout=1800,
                output=file,
            )
        import tarfile

        with tarfile.open(attachments, "r|") as archive:
            for _ in archive:
                pass
        if database.stat().st_size < 5 or attachments.stat().st_size < 1024:
            raise OperationError("Backup validation failed.")

    def required_space(self, deployment: dict[str, Any]) -> int:
        database = self.compose(
            deployment,
            [
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "noted",
                "-d",
                "noted",
                "-Atc",
                "SELECT pg_database_size(current_database())",
            ],
            "Database size inspection",
        )
        script = (
            "import os; print(sum(os.path.getsize(os.path.join(root, name)) "
            "for root, _, names in os.walk('/data/attachments') for name in names))"
        )
        files = self.compose(
            deployment,
            ["exec", "-T", "backend", "python", "-c", script],
            "Attachment size inspection",
        )
        return max(268435456, 2 * (int(database.strip()) + int(files.strip())))
