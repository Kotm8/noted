from io import BytesIO
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from tests.conftest import API, TEST_ORIGIN
from tests.test_backups import export, upload
from tests.test_media import animated_gif


def test_channel_banner_lifecycle_and_access(
    owner: TestClient, channel: dict, app: FastAPI
) -> None:
    path = f"{API}/channels/{channel['id']}/banner"
    original = owner.put(path, files={"file": ("banner.gif", animated_gif(), "image/gif")})
    assert original.status_code == 200
    data = original.json()
    assert "banner_storage_key" not in data
    response = owner.get(data["banner_url"])
    assert response.status_code == 200
    image = Image.open(BytesIO(response.content))
    assert image.size == (512, 256)
    assert image.n_frames == 2
    assert image.info["duration"] == 100
    assert image.info["loop"] == 0
    channels = owner.get(f"{API}/workspaces/{channel['workspace_id']}/channels").json()
    assert channels[0]["banner_url"] == data["banner_url"]
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as anonymous:
        assert anonymous.get(path).status_code == 401
        assert (
            anonymous.put(path, files={"file": ("banner.gif", animated_gif())}).status_code == 401
        )
    assert owner.delete(path, headers={"X-CSRF-Token": ""}).status_code == 403
    assert owner.put(path, files={"file": ("bad.svg", b"<svg/>")}).status_code == 422
    assert owner.get(data["banner_url"]).content == response.content
    changed = owner.put(path, files={"file": ("next.gif", animated_gif())}).json()
    assert changed["banner_url"] != data["banner_url"]
    stored = [file for file in app.state.settings.storage_path.rglob("*") if file.is_file()]
    assert len(stored) == 1
    assert owner.delete(path).json()["banner_url"] is None
    assert owner.get(path).status_code == 404
    assert not [file for file in app.state.settings.storage_path.rglob("*") if file.is_file()]
    assert (
        owner.put(
            f"{API}/channels/{uuid4()}/banner", files={"file": ("image.gif", animated_gif())}
        ).status_code
        == 404
    )


def test_banner_survives_portable_backup_import(owner: TestClient, channel: dict) -> None:
    source = owner.put(
        f"{API}/channels/{channel['id']}/banner",
        files={"file": ("image.gif", animated_gif())},
    ).json()
    expected = owner.get(source["banner_url"]).content
    ready, archive = export(owner)
    assert ready["counts"]["files"] == 1
    preview = upload(owner, archive)
    assert preview.status_code == 200
    assert (
        owner.post(f"{API}/backups/import", json={"token": preview.json()["token"]}).status_code
        == 200
    )
    project = next(
        item
        for item in owner.get(f"{API}/workspaces").json()
        if item["id"] != channel["workspace_id"]
    )
    restored = owner.get(f"{API}/workspaces/{project['id']}/channels").json()[0]
    assert restored["banner_url"] != source["banner_url"]
    assert owner.get(restored["banner_url"]).content == expected
