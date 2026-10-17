from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.workspaces.services.icon_images import MAX_ICON_FRAMES
from tests.conftest import API


def image_bytes(image: Image.Image, image_format: str = "PNG") -> bytes:
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def test_icon_stretches_to_square_and_note_images_are_unchanged(
    owner: TestClient, channel: dict[str, str]
) -> None:
    source = Image.new("RGB", (900, 300), "red")
    source.paste("blue", (300, 0, 600, 300))
    data = image_bytes(source)
    path = f"{API}/workspaces/{channel['workspace_id']}/icon"
    response = owner.put(path, files={"file": ("wide.png", data, "image/png")})
    assert response.status_code == 200
    result = Image.open(BytesIO(owner.get(response.json()["icon_url"]).content))
    assert result.size == (512, 512)
    assert result.convert("RGB").getpixel((256, 256)) == (0, 0, 255)
    assert result.convert("RGB").getpixel((0, 256)) == (255, 0, 0)
    assert result.convert("RGB").getpixel((511, 256)) == (255, 0, 0)
    note = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": ("wide.png", data, "image/png")},
    ).json()
    assert owner.get(note["attachments"][0]["preview_url"]).content == data


def test_gif_icons_preserve_animation_timing_loop_and_transparency(
    owner: TestClient, channel: dict[str, str]
) -> None:
    frames = [Image.new("RGBA", (64, 32)) for _ in range(2)]
    frames[0].paste("red", (20, 8, 40, 24))
    frames[1].paste("blue", (20, 8, 40, 24))
    output = BytesIO()
    frames[0].save(
        output,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=[80, 160],
        loop=3,
        disposal=2,
    )
    response = owner.put(
        f"{API}/workspaces/{channel['workspace_id']}/icon",
        files={"file": ("wide.gif", output.getvalue(), "image/gif")},
    )
    assert response.status_code == 200
    image = Image.open(BytesIO(owner.get(response.json()["icon_url"]).content))
    assert image.size == (512, 512)
    assert image.n_frames == 2
    assert image.info["loop"] == 3
    assert image.info["duration"] == 80
    assert image.convert("RGBA").getpixel((0, 0))[3] == 0
    assert image.convert("RGB").getpixel((256, 256)) == (255, 0, 0)
    image.seek(1)
    assert image.info["duration"] == 160
    assert image.convert("RGB").getpixel((256, 256)) == (0, 0, 255)


@pytest.mark.parametrize("kind", ["frames", "size"])
def test_icon_processing_limits_preserve_existing_icon(
    owner: TestClient, channel: dict[str, str], kind: str
) -> None:
    path = f"{API}/workspaces/{channel['workspace_id']}/icon"
    original = owner.put(
        path, files={"file": ("valid.png", image_bytes(Image.new("RGB", (20, 20))), "image/png")}
    ).json()
    if kind == "size":
        data = b"x" * (5 * 1024 * 1024 + 1)
        expected = 413
    else:
        output = BytesIO()
        frames = [Image.new("RGB", (2, 2), (index, 0, 0)) for index in range(MAX_ICON_FRAMES + 1)]
        frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:], duration=20)
        data = output.getvalue()
        expected = 422
    assert owner.put(path, files={"file": ("large.gif", data, "image/gif")}).status_code == expected
    assert owner.get(original["icon_url"]).status_code == 200
