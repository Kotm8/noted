import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import API

COMMIT = "b" * 40
CHECKSUM = "c" * 64


@pytest.fixture
def update_directory(app: FastAPI, tmp_path: Path) -> Path:
    directory = tmp_path / "updates"
    for name in ("state", "requests"):
        (directory / name).mkdir(parents=True)
    app.state.settings.updates_directory = directory
    (directory / "state" / "heartbeat.json").write_text(
        json.dumps({"at": datetime.now(UTC).isoformat()})
    )
    (directory / "state" / "service.json").write_text(
        json.dumps(
            {
                "repository": "owner/noted",
                "installed": {
                    "commit": "a" * 40,
                    "schema": "0003_attachment_order",
                    "version": "0.1.0",
                    "sequence": 1,
                },
                "latest": {
                    "commit": COMMIT,
                    "manifest_sha256": CHECKSUM,
                    "version": "0.1.1",
                    "sequence": 2,
                    "url": "https://github.com/owner/noted/releases/tag/main-" + COMMIT,
                    "notes": "An update",
                    "published_at": datetime.now(UTC).isoformat(),
                },
            }
        )
    )
    return directory


def test_updates_require_auth_and_csrf(client: TestClient, owner: TestClient) -> None:
    client.cookies.clear()
    assert client.get(f"{API}/updates/status").status_code == 401


def test_unconfigured_updates_are_honest(owner: TestClient) -> None:
    assert owner.get(f"{API}/updates/status").json()["configured"] is False
    assert owner.post(f"{API}/updates/check").status_code == 503


def test_check_only_queues_a_check(owner: TestClient, update_directory: Path) -> None:
    owner.headers.pop("X-CSRF-Token")
    assert owner.post(f"{API}/updates/check").status_code == 403
    owner.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
    for _ in range(2):
        assert owner.post(f"{API}/updates/check").status_code == 202
    assert {path.name for path in (update_directory / "requests").iterdir()} == {"check.json"}
    assert owner.get(f"{API}/updates/status").json()["available"] is True


def test_install_requires_current_manifest_and_is_idempotent(
    owner: TestClient, update_directory: Path
) -> None:
    path = f"{API}/updates/apply"
    assert owner.post(path, json={"commit": COMMIT, "manifest_sha256": "d" * 64}).status_code == 409
    data = {"commit": COMMIT, "manifest_sha256": CHECKSUM}
    first = owner.post(path, json=data)
    assert first.status_code == 202
    assert owner.post(path, json=data).json()["id"] == first.json()["id"]
    assert owner.get(f"{API}/updates/status").json()["job"]["status"] == "queued"
    request = json.loads((update_directory / "requests" / "apply.json").read_text())
    assert set(request) == {"id", "commit", "manifest_sha256", "requested_by", "created_at"}


def test_offline_worker_blocks_install(owner: TestClient, update_directory: Path) -> None:
    (update_directory / "state" / "heartbeat.json").write_text(
        json.dumps({"at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat()})
    )
    assert owner.get(f"{API}/updates/status").json()["worker_online"] is False
    assert owner.post(f"{API}/updates/check").status_code == 503
    assert (
        owner.post(
            f"{API}/updates/apply", json={"commit": COMMIT, "manifest_sha256": CHECKSUM}
        ).status_code
        == 503
    )


def test_recovery_blocks_new_requests(owner: TestClient, update_directory: Path) -> None:
    (update_directory / "state" / "job.json").write_text(
        json.dumps(
            {
                "id": str(uuid4()),
                "commit": COMMIT,
                "status": "needs_recovery",
                "phase": "failed",
                "detail": "Maintenance remains active.",
                "started_at": datetime.now(UTC).isoformat(),
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )
    )
    assert (
        owner.post(
            f"{API}/updates/apply", json={"commit": COMMIT, "manifest_sha256": CHECKSUM}
        ).status_code
        == 409
    )
    assert not (update_directory / "requests" / "apply.json").exists()
