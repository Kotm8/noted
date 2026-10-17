import json
import os
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import URLError
from urllib.request import urlopen
from uuid import uuid4

from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.db.database import create_database_engine
from tests.browser_runner import BROWSER_PASSWORD, ROOT, clean_temporary_storage


def wait_for(url: str, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("The desktop test process stopped before becoming ready.")
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError, ConnectionError):
            time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for {url}")


def main() -> int:
    executable = ROOT / "apps/desktop/src-tauri/target/debug/noted-desktop.exe"
    node = shutil.which("node")
    if node is None or not executable.is_file():
        raise SystemExit("Install Node.js and run npm run build:debug in apps/desktop first.")
    schema = f"noted_desktop_{uuid4().hex}"
    admin = create_database_engine(os.environ["NOTED_TEST_DATABASE_URL"])
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(os.environ["NOTED_TEST_DATABASE_URL"]).update_query_dict(
        {"options": f"-csearch_path={schema}"}
    )
    engine = create_database_engine(url.render_as_string(hide_password=False))
    storage = TemporaryDirectory(prefix="desktop-files-", dir=ROOT / ".local")
    directory = Path(storage.name)
    api = None
    desktop = None
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        debug_port = listener.getsockname()[1]
    environment = {
        **os.environ,
        "NOTED_DATABASE_URL": url.render_as_string(hide_password=False),
        "NOTED_APP_ORIGIN": "http://localhost:8000",
        "NOTED_COOKIE_SECURE": "false",
        "NOTED_STORAGE_PATH": str(directory / "attachments"),
        "NOTED_BACKUP_PATH": str(directory / "backups"),
        "NOTED_DESKTOP_TEST_DIRECTORY": str(directory / "profile"),
        "NOTED_DESKTOP_TEST_DOWNLOADS": str(directory / "downloads"),
        "NOTED_DESKTOP_DEBUG_PORT": str(debug_port),
    }
    (directory / "downloads").mkdir()
    try:
        migration = Config(str(ROOT / "backend/alembic.ini"))
        with engine.begin() as connection:
            migration.attributes["connection"] = connection
            command.upgrade(migration, "head")
        with Session(engine) as db:
            AuthService(db).provision_owner(
                LoginRequest.model_validate({"username": "ilya", "password": BROWSER_PASSWORD})
            )
        with (
            (ROOT / ".local/desktop-api.log").open("wb") as api_log,
            (ROOT / ".local/desktop-app.log").open("wb") as desktop_log,
        ):
            api = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:create_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "8000",
                ],
                cwd=ROOT / "backend",
                env=environment,
                stdout=api_log,
                stderr=api_log,
            )
            wait_for("http://127.0.0.1:8000/api/v1/health/ready", api)
            desktop = subprocess.Popen(
                [str(executable)],
                cwd=ROOT,
                env=environment,
                stdout=desktop_log,
                stderr=desktop_log,
            )
            wait_for(f"http://127.0.0.1:{debug_port}/json/version", desktop)
            result = subprocess.run(
                [node, "tests/desktop.mjs", str(debug_port), str(directory)],
                cwd=ROOT / "apps/desktop",
                env=environment,
                check=False,
            )
            if result.returncode:
                return result.returncode
            backups = list((directory / "downloads").glob("*.zip"))
            if len(backups) != 1:
                raise RuntimeError("The desktop backup download is missing.")
            with zipfile.ZipFile(backups[0]) as archive:
                content = json.loads(archive.read("content.json"))
                assert archive.testzip() is None
                assert any(
                    m["content"] == "Native desktop persistence" for m in content["messages"]
                )
                assert any(
                    archive.read(name) == bytes([42]) * 1048576
                    for name in archive.namelist()
                    if name.startswith("files/")
                )
                assert not {"users", "sessions", "credentials"}.intersection(content)
            desktop.terminate()
            desktop.wait(timeout=15)
            desktop = subprocess.Popen(
                [str(executable)],
                cwd=ROOT,
                env=environment,
                stdout=desktop_log,
                stderr=desktop_log,
            )
            wait_for(f"http://127.0.0.1:{debug_port}/json/version", desktop)
            result = subprocess.run(
                [node, "tests/desktop.mjs", str(debug_port), str(directory), "reconnect"],
                cwd=ROOT / "apps/desktop",
                env=environment,
                check=False,
            )
            if result.returncode == 0:
                result_file = ROOT / ".local/desktop-smoke.json"
                result_file.write_text(
                    json.dumps(
                        {
                            "passed": True,
                            "native_webview": True,
                            "profile_reconnect": True,
                            "database_isolated": True,
                        },
                        indent=2,
                    )
                )
            return result.returncode
    finally:
        for process in [desktop, api]:
            if process is not None and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        engine.dispose()
        try:
            clean_temporary_storage(storage)
        finally:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
