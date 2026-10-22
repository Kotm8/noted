import os
import shutil
import subprocess
import sys
import time
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
from tests.suites import browser_arguments

ROOT = Path(__file__).resolve().parents[2]
BROWSER_PASSWORD = "browser-test-password-only"


def wait_until_ready(server: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError("The browser test API stopped before becoming ready.")
        try:
            with urlopen("http://127.0.0.1:8000/api/v1/health/ready", timeout=1) as response:
                if response.status == 200:
                    return
        except (URLError, TimeoutError):
            time.sleep(0.2)
    raise RuntimeError("The browser test API did not become ready in time.")


def clean_temporary_storage(storage: TemporaryDirectory[str]) -> None:
    directory = Path(storage.name).resolve()
    if not directory.is_relative_to((ROOT / ".local").resolve()):
        raise RuntimeError("The temporary storage directory is outside the workspace.")
    for attempt in range(20):
        try:
            storage.cleanup()
            return
        except OSError as error:
            if not isinstance(error, PermissionError) and getattr(error, "winerror", None) != 145:
                raise
            if attempt == 19:
                raise
            time.sleep(0.25)


def main() -> int:
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Install Node.js before running browser tests.")

    base_url = os.environ["NOTED_TEST_DATABASE_URL"]
    schema_name = f"noted_browser_{uuid4().hex}"
    admin_engine = create_database_engine(base_url)

    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))

    isolated_url = make_url(base_url).update_query_dict({"options": f"-csearch_path={schema_name}"})
    engine = create_database_engine(isolated_url.render_as_string(hide_password=False))
    server = None
    temporary_storage = TemporaryDirectory(prefix="browser-files-", dir=ROOT / ".local")

    try:
        config = Config(str(ROOT / "backend/alembic.ini"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

        with Session(engine) as db:
            AuthService(db).provision_owner(
                LoginRequest.model_validate({"username": "ilya", "password": BROWSER_PASSWORD})
            )

        environment = os.environ.copy()
        environment["NOTED_DATABASE_URL"] = isolated_url.render_as_string(hide_password=False)
        environment["PLAYWRIGHT_BROWSERS_PATH"] = str(ROOT / ".local/browsers")
        environment["NOTED_STORAGE_PATH"] = temporary_storage.name
        server = subprocess.Popen(
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
                "--no-access-log",
            ],
            cwd=ROOT / "backend",
            env=environment,
        )
        wait_until_ready(server)

        result = subprocess.run(
            [
                node,
                "node_modules/@playwright/test/cli.js",
                "test",
                *browser_arguments(sys.argv[1:]),
            ],
            cwd=ROOT / "apps/web",
            env=environment,
            check=False,
        )
        return result.returncode
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        engine.dispose()
        try:
            clean_temporary_storage(temporary_storage)
        finally:
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema_name}" CASCADE'))
            admin_engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
