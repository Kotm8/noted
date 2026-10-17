import hashlib
import io
import json
import secrets
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import zipfile
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "updater"))

from noted_updater.config import Config
from noted_updater.docker import Docker
from noted_updater.engine import Engine, verify_http
from noted_updater.files import read_json, write_json
from noted_updater.release import Manifest, Release

ROOT = Path(__file__).resolve().parents[1]


def command(arguments: list[str], content: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["docker", *arguments],
        input=content,
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Docker operation failed: {arguments[0]}")
    return result.stdout


def run() -> None:
    project = f"noted-update-test-{uuid4().hex[:8]}"
    local = ROOT / ".local"
    local.mkdir(exist_ok=True)
    temporary = tempfile.TemporaryDirectory(prefix="updater-smoke-", dir=local)
    directory = Path(temporary.name).resolve()
    if not directory.is_relative_to(local.resolve()):
        raise RuntimeError("Unsafe test directory")
    config = Config(directory, "example/noted", project=project)
    docker = Docker(config)
    initial = {"compose": str(directory / "compose.production.yaml")}
    target_tag = f"noted/backend:{project}"
    web_tag = f"noted/web:{project}"
    commit = "b" * 40
    version = "0.1.1-main.bbbbbbbbbbbb"
    try:
        print("Building test release images.", flush=True)
        command(
            [
                "build",
                "--build-arg",
                f"NOTED_BUILD_COMMIT={commit}",
                "--build-arg",
                f"NOTED_BUILD_VERSION={version}",
                "-t",
                target_tag,
                "-f",
                "backend/Dockerfile",
                ".",
            ]
        )
        command(["build", "-t", web_tag, "-f", "apps/web/Dockerfile", "."])
        target_schema = (
            command(
                [
                    "run",
                    "--rm",
                    "--entrypoint",
                    "python",
                    target_tag,
                    "-c",
                    "from app.core.config import SCHEMA_REVISION; print(SCHEMA_REVISION)",
                ]
            )
            .decode()
            .strip()
        )
        old_backend = (
            command(["image", "inspect", "--format", "{{.Id}}", "noted/backend:0.1.0-local"])
            .decode()
            .strip()
        )
        old_web = (
            command(["image", "inspect", "--format", "{{.Id}}", "noted/web:0.1.0-local"])
            .decode()
            .strip()
        )
        backend = command(["image", "inspect", "--format", "{{.Id}}", target_tag]).decode().strip()
        web = command(["image", "inspect", "--format", "{{.Id}}", web_tag]).decode().strip()
        production = (ROOT / "deploy/compose.production.yaml").read_text()
        production = production.replace(
            "https://${NOTED_DOMAIN:?Set the app domain}", "http://localhost:18082"
        )
        production = production.replace(
            "NOTED_COOKIE_SECURE: 'true'", "NOTED_COOKIE_SECURE: 'false'"
        )
        production = production.replace("'80:80'", "'127.0.0.1:18082:80'").replace(
            "      - '443:443'\n", ""
        )
        proxy = (
            (ROOT / "deploy/Caddyfile.production")
            .read_text()
            .replace("{$NOTED_DOMAIN}", "http://:80")
        )
        (directory / "compose.production.yaml").write_text(production)
        (directory / "Caddyfile.production").write_text(proxy)
        (directory / ".env").write_text(
            f"POSTGRES_PASSWORD={secrets.token_hex(24)}\nNOTED_DOMAIN=localhost\n"
            f"NOTED_SERVER_NAME=Upgrade test\nNOTED_BACKEND_IMAGE={old_backend}\n"
            f"NOTED_WEB_IMAGE={old_web}\n"
        )
        for path in (config.state, config.requests, config.maintenance.parent):
            path.mkdir(parents=True)
        print(
            "Starting an isolated installation and creating notes and an attachment.",
            flush=True,
        )
        docker.compose(
            initial,
            ["up", "-d", "--wait", "--wait-timeout", "120"],
            "Test startup",
            timeout=180,
        )
        old_version = json.loads(
            docker.compose(
                initial,
                [
                    "exec",
                    "-T",
                    "backend",
                    "python",
                    "-c",
                    "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/api/v1/version').read().decode())",
                ],
                "Version inspection",
            )
        )
        installed = {
            **initial,
            "origin": "http://localhost:18082",
            "commit": old_version.get("build_commit", "development"),
            "version": old_version["version"],
            "schema": old_version["schema_revision"],
            "sequence": 1,
        }
        password = secrets.token_urlsafe(24)
        credential_file = directory / "owner-input.json"
        credential_file.write_text(json.dumps({"username": "upgrade-owner", "password": password}))
        try:
            with credential_file.open("rb") as file:
                docker.compose(
                    initial,
                    [
                        "exec",
                        "-T",
                        "backend",
                        "python",
                        "-m",
                        "app.cli",
                        "create-owner",
                        "--stdin",
                    ],
                    "Test owner",
                    input_file=file,
                )
        finally:
            credential_file.unlink()
        cookies = CookieJar()
        browser = build_opener(HTTPCookieProcessor(cookies))

        def request(path, body=None, method=None, content_type="application/json"):
            headers = {"Origin": installed["origin"], "Content-Type": content_type}
            for cookie in cookies:
                if cookie.name == "noted_csrf":
                    headers["X-CSRF-Token"] = cookie.value
            encoded = json.dumps(body).encode() if isinstance(body, dict) else body
            with browser.open(
                Request(
                    installed["origin"] + "/api/v1" + path,
                    data=encoded,
                    headers=headers,
                    method=method,
                ),
                timeout=10,
            ) as response:
                raw = response.read()
                return (
                    json.loads(raw)
                    if "application/json" in response.headers.get("Content-Type", "")
                    else raw
                )

        request("/auth/login", {"username": "upgrade-owner", "password": password})
        workspace = request("/workspaces", {"name": "Preserve me"})
        channel = request(f"/workspaces/{workspace['id']}/channels", {"name": "journal"})
        boundary = "noted-test-boundary"
        payload = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n'
            "This note must survive the update.\r\n"
            f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="kept.txt"\r\n'
            "Content-Type: text/plain\r\n\r\nattachment survives\r\n"
            f"--{boundary}--\r\n"
        ).encode()
        message = request(
            f"/channels/{channel['id']}/messages/with-files",
            payload,
            content_type=f"multipart/form-data; boundary={boundary}",
        )
        attachment = message["attachments"]
        write_json(config.control / "installed.json", installed)
        write_json(config.state / "service.json", {"installed": installed})
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            for name in ("compose.production.yaml", "Caddyfile.production"):
                archive.add(directory / name, arcname=name)
        raw = buffer.getvalue()
        release = Release(
            Manifest(
                config.repository,
                commit,
                2,
                version,
                target_schema,
                (installed["schema"],),
                backend,
                web,
                hashlib.sha256(raw).hexdigest(),
            ),
            "c" * 64,
            "https://example.invalid/fixture",
            "https://example.invalid/fixture",
            "Local test",
            "2026-10-15T12:00:00Z",
        )

        class Source:
            def latest(self):
                return release

            def bundle(self, selected):
                return raw

        engine = Engine(config, Source(), docker)
        database_container = docker.compose(
            initial, ["ps", "-q", "db"], "Database identity"
        ).strip()
        engine.download_available(engine.check())
        assert not config.maintenance.exists()
        assert request(f"/channels/{channel['id']}/messages")["items"][0]["id"] == message["id"]
        identifier = str(uuid4())
        print("Applying the prepared update with a real backup and migration.", flush=True)
        engine.apply({"id": identifier, "commit": commit, "manifest_sha256": "c" * 64})
        job = read_json(config.state / "job.json")
        if job["status"] != "succeeded":
            raise RuntimeError(job["detail"])
        current = read_json(engine.ledger)
        verify_http(current["origin"], commit, target_schema, version)
        assert request("/auth/sessions")[0]["is_current"] is True
        appearance = request("/settings/appearance", {"messageLayout": "connected"}, method="PUT")
        assert appearance["messageLayout"] == "connected"
        assert request("/settings/appearance")["messageLayout"] == "connected"
        assert (
            docker.compose(current, ["ps", "-q", "db"], "Database identity").strip()
            == database_container
        )
        notes = request(f"/channels/{channel['id']}/messages")["items"]
        assert notes[0]["id"] == message["id"]
        assert notes[0]["content"] == message["content"]
        assert notes[0]["attachments"][0]["id"] == attachment[0]["id"]
        assert request(f"/attachments/{attachment[0]['id']}/download") == b"attachment survives"
        print("Restoring the backup into a separate test database.", flush=True)
        backup = directory / "backups" / identifier
        docker.compose(
            current,
            ["exec", "-T", "db", "createdb", "-U", "noted", "noted_restore_test"],
            "Restore database",
        )
        with (backup / "database.dump").open("rb") as file:
            docker.compose(
                current,
                [
                    "exec",
                    "-T",
                    "db",
                    "pg_restore",
                    "-U",
                    "noted",
                    "-d",
                    "noted_restore_test",
                    "--no-owner",
                    "--exit-on-error",
                ],
                "Backup restore",
                input_file=file,
            )
        restored = docker.compose(
            current,
            [
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "noted",
                "-d",
                "noted_restore_test",
                "-Atc",
                "SELECT content FROM messages",
            ],
            "Restored note",
        )
        assert message["content"] in restored
        with tarfile.open(backup / "attachments.tar") as archive:
            files = [archive.extractfile(member).read() for member in archive if member.isfile()]
        assert b"attachment survives" in files
        print("Verifying portable CLI import into a fresh owner account.", flush=True)
        portable = directory / "portable.zip"
        with portable.open("wb") as output:
            docker.compose(
                current,
                ["exec", "-T", "backend", "python", "-m", "app.portability", "export"],
                "Portable CLI export",
                output=output,
            )
        with zipfile.ZipFile(portable) as archive:
            metadata = json.loads(archive.read("content.json"))
            assert "users" not in metadata and "author_id" not in metadata["messages"][0]
        docker.compose(
            current,
            ["exec", "-T", "db", "createdb", "-U", "noted", "noted_portable_test"],
            "Portable destination database",
        )
        script = textwrap.dedent("""
            import asyncio, os
            base_url = os.environ['NOTED_DATABASE_URL'].rsplit('/', 1)[0]
            os.environ['NOTED_DATABASE_URL'] = base_url + '/noted_portable_test'
            os.environ['NOTED_STORAGE_PATH'] = '/tmp/noted-portable-files'
            from alembic import command
            from alembic.config import Config
            command.upgrade(Config('alembic.ini'), 'head')
            from sqlalchemy import select
            from sqlalchemy.orm import Session
            from app.core.config import Settings
            from app.db.database import create_database_engine
            from app.notes.models import Message
            from app.auth.models import User
            from app.auth.schemas import LoginRequest
            from app.auth.services.auth import AuthService
            engine = create_database_engine(Settings().database_url)
            with Session(engine) as db:
                credentials = {
                    'username': 'portable-owner',
                    'password': 'portable-fixture-password',
                }
                AuthService(db).provision_owner(LoginRequest.model_validate(credentials))
            from app.backup.cli import run
            asyncio.run(run('import'))
            with Session(engine) as db:
                user = db.scalar(select(User))
                note = db.scalar(select(Message))
                assert user.username == 'portable-owner'
                assert note.author_id == user.id
                assert note.content == 'This note must survive the update.'
                key = note.attachments[0].storage_key
            from pathlib import Path
            assert (Path('/tmp/noted-portable-files') / key).read_bytes() == b'attachment survives'
            engine.dispose()
        """)
        with portable.open("rb") as source:
            docker.compose(
                current,
                [
                    "run",
                    "--rm",
                    "--no-deps",
                    "-T",
                    "--entrypoint",
                    "python",
                    "backend",
                    "-c",
                    script,
                ],
                "Portable destination import",
                input_file=source,
            )
        print(
            "PASS: update, session, notes, attachment, database identity, and backup restoration.",
            flush=True,
        )
    finally:
        if (directory / ".env").exists():
            docker.compose(
                initial,
                ["down", "--volumes", "--remove-orphans"],
                "Isolated test cleanup",
                timeout=120,
            )
        for image in (target_tag, web_tag):
            subprocess.run(["docker", "image", "rm", image], capture_output=True, check=False)
        temporary.cleanup()


if __name__ == "__main__":
    run()
