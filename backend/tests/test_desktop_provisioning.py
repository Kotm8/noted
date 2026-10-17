import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.models import User
from tests.conftest import API, TEST_PASSWORD


def test_desktop_owner_provisioning_retries_without_replacing_an_account(
    client: TestClient, db: Session, database_url: str
) -> None:
    root = Path(__file__).resolve().parents[2]
    script = (
        "import sys; "
        "sys.path.insert(0, '../updater'); "
        "from noted_updater.install import OWNER_SCRIPT; "
        "exec(OWNER_SCRIPT)"
    )

    def provision(username: str, password: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [sys.executable, "-c", script],
            input=json.dumps({"username": username, "password": password}).encode(),
            capture_output=True,
            timeout=30,
            cwd=root / "backend",
            env={**os.environ, "NOTED_DATABASE_URL": database_url},
        )

    assert provision("owner", TEST_PASSWORD).returncode == 0
    assert provision("owner", TEST_PASSWORD).returncode == 0
    assert provision("owner", "different-password-for-tests").returncode != 0
    assert provision("someone-else", TEST_PASSWORD).returncode != 0
    assert db.scalar(select(func.count()).select_from(User)) == 1
    assert (
        client.post(
            f"{API}/auth/login", json={"username": "owner", "password": TEST_PASSWORD}
        ).status_code
        == 200
    )
