from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from uuid import UUID

import anyio
from PIL import Image

from app.notes.images.encoding import encode_preview
from app.notes.images.worker import backfill_previews
from app.notes.models import Attachment
from tests.conftest import API
from tests.test_backups import export, upload
from tests.test_media import animated_gif


def image_bytes(image, format="PNG", **options):
    output = BytesIO()
    image.save(output, format=format, **options)
    return output.getvalue()


def attach(owner, channel, data, filename="photo.png", content_type="image/png"):
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files={"files": (filename, data, content_type)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_large_image_has_compressed_preview_and_byte_exact_original(owner, channel):
    raw = image_bytes(Image.effect_noise((2400, 1200), 90).convert("RGB"), "JPEG", quality=98)
    message = attach(owner, channel, raw, "photo.jpg", "image/jpeg")
    file = message["attachments"][0]
    assert (file["width"], file["height"]) == (2400, 1200)
    assert "preview_storage_key" not in file
    preview = owner.get(file["preview_url"])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/webp"
    assert len(preview.content) < len(raw) / 2
    assert Image.open(BytesIO(preview.content)).size == (1280, 640)
    original = owner.get(file["original_url"])
    assert original.content == raw and original.headers["content-type"] == "image/jpeg"
    assert original.headers["content-disposition"].startswith("inline;")
    assert original.headers["cache-control"].startswith("private,")
    assert owner.get(file["download_url"]).content == raw
    owner.delete(f"{API}/messages/{message['id']}")
    assert owner.get(file["original_url"]).status_code == 404
    assert owner.get(file["preview_url"]).status_code == 404


def test_preview_respects_exif_orientation_without_changing_original(owner, channel):
    image = Image.new("RGB", (600, 300), "red")
    exif = Image.Exif()
    exif[274] = 6
    raw = image_bytes(image, "JPEG", exif=exif)
    file = attach(owner, channel, raw, "rotated.jpg", "image/jpeg")["attachments"][0]
    assert (file["width"], file["height"]) == (300, 600)
    preview = Image.open(BytesIO(owner.get(file["preview_url"]).content))
    assert preview.size == (300, 600)
    assert owner.get(file["original_url"]).content == raw


def test_transparency_and_animation_are_preserved():
    image = Image.new("RGBA", (100, 70), (40, 120, 90, 0))
    image.putpixel((50, 30), (255, 0, 0, 255))
    preview = encode_preview(BytesIO(image_bytes(image)))
    result = Image.open(BytesIO(preview.data)).convert("RGBA")
    assert result.getpixel((0, 0))[3] == 0
    assert result.getpixel((50, 30))[3] == 255
    gif = encode_preview(BytesIO(animated_gif()))
    result = Image.open(BytesIO(gif.data))
    assert result.n_frames == 2
    assert result.info["loop"] == 0
    result.seek(0)
    first = result.convert("RGB").getpixel((0, 0))
    result.seek(1)
    second = result.convert("RGB").getpixel((0, 0))
    assert first != second


def test_long_animations_limit_preview_frames_without_shortening_duration():
    frames = [Image.new("RGB", (8, 8), (index, 30, 90)) for index in range(130)]
    output = BytesIO()
    frames[0].save(
        output, format="GIF", save_all=True, append_images=frames[1:], duration=40, loop=0
    )
    preview = encode_preview(BytesIO(output.getvalue()))
    result = Image.open(BytesIO(preview.data))
    assert result.n_frames <= 120
    duration = 0
    for index in range(result.n_frames):
        result.seek(index)
        result.load()
        duration += result.info["duration"]
    assert duration == 130 * 40


def test_existing_images_are_generated_once_and_concurrent_requests_share_preview(
    owner, channel, db, app
):
    raw = image_bytes(Image.new("RGB", (900, 400), "green"))
    file = attach(owner, channel, raw)["attachments"][0]
    record = db.get(Attachment, UUID(file["id"]))
    old = record.preview_storage_key
    record.preview_storage_key = None
    record.preview_size = None
    record.width = record.height = None
    db.commit()
    anyio.run(app.state.storage.delete, old)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: owner.get(file["preview_url"]), range(2)))
    assert all(result.status_code == 200 for result in results)
    assert results[0].content == results[1].content
    db.expire_all()
    record = db.get(Attachment, UUID(file["id"]))
    first_key = record.preview_storage_key
    assert (record.width, record.height) == (900, 400)
    assert anyio.run(backfill_previews, db.get_bind(), app.state.storage) == 0
    assert db.get(Attachment, UUID(file["id"])).preview_storage_key == first_key


def test_background_backfill_skips_missing_originals_and_does_not_repeat(owner, channel, db, app):
    file = attach(owner, channel, animated_gif(), "clip.gif", "image/gif")["attachments"][0]
    record = db.get(Attachment, UUID(file["id"]))
    old = record.preview_storage_key
    record.preview_storage_key = None
    record.width = record.height = None
    db.commit()
    anyio.run(app.state.storage.delete, old)
    assert anyio.run(backfill_previews, db.get_bind(), app.state.storage) == 1
    db.expire_all()
    record = db.get(Attachment, UUID(file["id"]))
    assert (record.width, record.height) == (8, 8)
    record.preview_storage_key = None
    db.commit()
    anyio.run(app.state.storage.delete, record.storage_key)
    assert anyio.run(backfill_previews, db.get_bind(), app.state.storage) == 1
    assert anyio.run(backfill_previews, db.get_bind(), app.state.storage) == 0


def test_failed_batch_removes_both_original_and_generated_preview(owner, channel, app):
    raw = image_bytes(Image.new("RGB", (30, 40), "yellow"))
    response = owner.post(
        f"{API}/channels/{channel['id']}/messages/with-files",
        files=[
            ("files", ("okay.png", raw, "image/png")),
            ("files", ("bad.png", b"invalid", "image/png")),
        ],
    )
    assert response.status_code == 422
    assert not [file for file in app.state.settings.storage_path.rglob("*") if file.is_file()]


def test_backup_preserves_original_and_regenerates_preview_after_restore(owner, channel, db, app):
    raw = animated_gif()
    attach(owner, channel, raw, "clip.gif", "image/gif")
    _, archive = export(owner)
    preview = upload(owner, archive)
    assert preview.status_code == 200, preview.text
    response = owner.post(
        f"{API}/backups/import",
        json={
            "token": preview.json()["token"],
            "mode": "replace",
            "confirmation": "REPLACE MY NOTES",
        },
    )
    assert response.status_code == 200, response.text
    assert anyio.run(backfill_previews, db.get_bind(), app.state.storage) == 1
    from sqlalchemy import select

    db.expire_all()
    record = db.scalar(select(Attachment))
    assert record.width == record.height == 8
    assert owner.get(f"{API}/attachments/{record.id}/original").content == raw
