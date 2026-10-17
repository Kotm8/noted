import base64
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import API, TEST_PASSWORD

KEY = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"x" * 32).decode()


@pytest.fixture
def host_directory(app: FastAPI, tmp_path: Path) -> Path:
    root = tmp_path / "host"
    (root / "state").mkdir(parents=True)
    (root / "requests").mkdir()
    app.state.settings.updates_directory = root
    (root / "state/heartbeat.json").write_text(json.dumps({"at": datetime.now(UTC).isoformat()}))
    (root / "state/service.json").write_text(
        json.dumps(
            {
                "repository": "owner/noted",
                "installed": {
                    "commit": "a" * 40,
                    "version": "0.1.0",
                    "schema": "0003_attachment_order",
                    "sequence": 1,
                },
                "capabilities": ["host-admin-v1"],
            }
        )
    )
    return root


def test_remove_requires_exact_phrase_password_and_instance(
    owner: TestClient, host_directory: Path
) -> None:
    body = {
        "confirmation": "I LOVE VERITY",
        "current_password": TEST_PASSWORD,
        "instance_id": "development",
    }
    for phrase in ("i love verity", "I LOVE VERITY ", ""):
        assert (
            owner.post(f"{API}/host/remove", json={**body, "confirmation": phrase}).status_code
            == 422
        )
    assert (
        owner.post(f"{API}/host/remove", json={**body, "current_password": "wrong"}).status_code
        == 401
    )
    assert (
        owner.post(f"{API}/host/remove", json={**body, "instance_id": "another-vps"}).status_code
        == 409
    )
    assert not (host_directory / "requests/host.json").exists()
    response = owner.post(f"{API}/host/remove", json=body)
    assert response.status_code == 202, response.text
    queued = json.loads((host_directory / "requests/host.json").read_text())
    assert queued["action"] == "remove"
    assert queued["confirmation"] == "I LOVE VERITY"
    assert "current_password" not in queued
    assert TEST_PASSWORD not in owner.get(f"{API}/host/status").text


def test_host_changes_need_csrf(owner: TestClient, host_directory: Path) -> None:
    owner.headers.pop("X-CSRF-Token")
    response = owner.post(
        f"{API}/host/remove",
        json={
            "confirmation": "I LOVE VERITY",
            "current_password": TEST_PASSWORD,
            "instance_id": "development",
        },
    )
    assert response.status_code == 403
    assert not (host_directory / "requests/host.json").exists()


def test_domain_queue_preserves_secrets_and_rejects_invalid_names(
    owner: TestClient, host_directory: Path
) -> None:
    body = {"current_password": TEST_PASSWORD, "dns_confirmed": True}
    for domain in (
        "https://new.example.com/path",
        "127.0.0.1",
        "local",
        "bad\nHOST=other",
        "-bad.example.com",
    ):
        assert owner.post(f"{API}/host/domain", json={**body, "domain": domain}).status_code == 422
    response = owner.post(f"{API}/host/domain", json={**body, "domain": "New.Example.com"})
    assert response.status_code == 202
    queued = json.loads((host_directory / "requests/host.json").read_text())
    assert queued["domain"] == "new.example.com"
    assert "current_password" not in queued


def test_transfer_credentials_are_only_in_private_request(
    owner: TestClient, host_directory: Path
) -> None:
    payload = {
        "ip": "1.1.1.1",
        "port": 22,
        "ssh_user": "root",
        "ssh_password": "ssh-secret-only",
        "host_key": KEY,
        "owner_username": "new-owner",
        "owner_password": "new-owner-secret-password",
        "current_password": TEST_PASSWORD,
        "pause_confirmed": True,
    }
    response = owner.post(f"{API}/host/transfer", json=payload)
    assert response.status_code == 202, response.text
    status = owner.get(f"{API}/host/status")
    assert "ssh-secret-only" not in status.text
    assert "new-owner-secret-password" not in status.text
    queued = json.loads((host_directory / "requests/host.json").read_text())
    assert queued["ssh_password"] == "ssh-secret-only"
    assert queued["owner_password"] == "new-owner-secret-password"
    assert "current_password" not in queued
    assert owner.post(f"{API}/host/probe", json={"ip": "1.1.1.1", "port": 22}).status_code == 409


def test_probe_rejects_private_targets(owner: TestClient, host_directory: Path) -> None:
    for ip in ("127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "host.example.com"):
        assert owner.post(f"{API}/host/probe", json={"ip": ip}).status_code == 422
    assert not (host_directory / "requests/host.json").exists()


def test_host_actions_are_disabled_without_host_worker(owner: TestClient) -> None:
    response = owner.get(f"{API}/host/status")
    assert response.json()["capable"] is False
    assert owner.post(f"{API}/host/probe", json={"ip": "1.1.1.1"}).status_code == 503
