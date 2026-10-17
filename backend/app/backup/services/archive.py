import hashlib
import stat
import struct
import zipfile
import zlib
from pathlib import Path
from typing import IO
from uuid import UUID

from pydantic import ValidationError as SchemaError
from starlette.datastructures import Headers, UploadFile

from app.backup.repository import MAX_RECORDS
from app.backup.schemas import BackupBlob, BackupContent, BackupCounts
from app.core.errors import ContentTooLargeError, ValidationError
from app.core.storage_limits import MAX_BATCH_SIZE, MAX_FILES
from app.storage.media import VIDEO_TYPES, detect_video_type, inspect_image

MAX_EXPANDED = 2 * 1024 * 1024 * 1024
MAX_METADATA = 16 * 1024 * 1024


def counts(data: BackupContent) -> BackupCounts:
    return BackupCounts(
        projects=len(data.workspaces),
        categories=len(data.categories),
        channels=len(data.channels),
        messages=len(data.messages),
        files=len(data.attachments)
        + sum(bool(project.image) for project in data.workspaces)
        + sum(bool(channel.image) for channel in data.channels),
    )


def blobs(data: BackupContent) -> list[tuple[BackupBlob, str | None]]:
    result: list[tuple[BackupBlob, str | None]] = [
        (item.file, item.content_type) for item in data.attachments
    ]
    result.extend((item.image, item.image_type) for item in data.workspaces if item.image)
    result.extend((item.image, item.image_type) for item in data.channels if item.image)
    return result


def validate_graph(data: BackupContent) -> None:
    groups = [
        [item.id for item in data.workspaces],
        [item.id for item in data.categories],
        [item.id for item in data.channels],
        [item.id for item in data.messages],
        [item.id for item in data.attachments],
    ]
    if sum(len(group) for group in groups) > MAX_RECORDS:
        raise ContentTooLargeError("The backup exceeds the 50,000 record limit.")
    for group in groups:
        if len(set(group)) != len(group):
            raise ValidationError("The backup contains duplicate record IDs.")
    projects = {item.id for item in data.workspaces}
    categories = {item.id: item.workspace_id for item in data.categories}
    channels = {item.id for item in data.channels}
    messages = {item.id for item in data.messages}
    if any(item.workspace_id not in projects for item in [*data.categories, *data.channels]):
        raise ValidationError("The backup contains an unknown project.")
    if any(
        item.category_id and categories.get(item.category_id) != item.workspace_id
        for item in data.channels
    ):
        raise ValidationError("The backup contains an invalid channel category.")
    if any(item.channel_id not in channels for item in data.messages):
        raise ValidationError("The backup contains an unknown channel.")
    if any(item.message_id not in messages for item in data.attachments):
        raise ValidationError("The backup contains an unknown message.")
    files = blobs(data)
    if len({item.path for item, _ in files}) != len(files):
        raise ValidationError("The backup contains duplicate file paths.")
    per_message: dict[UUID, list[int]] = {}
    for attachment in data.attachments:
        per_message.setdefault(attachment.message_id, []).append(attachment.file.size)
    if any(len(sizes) > MAX_FILES or sum(sizes) > MAX_BATCH_SIZE for sizes in per_message.values()):
        raise ValidationError("The backup exceeds the attachment limits for a message.")
    attached = set(per_message)
    if any(not item.content.strip() and item.id not in attached for item in data.messages):
        raise ValidationError("The backup contains an empty message without files.")


def read_content(path: Path) -> BackupContent:
    try:
        with path.open("rb") as source:
            source.seek(-22, 2)
            end = struct.unpack("<4s4H2IH", source.read(22))
        if (
            end[0] != b"PK\x05\x06"
            or end[1]
            or end[2]
            or end[3] != end[4]
            or end[4] > MAX_RECORDS + 1
            or end[5] > 8 * 1024 * 1024
            or end[7]
            or end[5] + end[6] != path.stat().st_size - 22
        ):
            raise ValidationError(
                "Choose a standard Noted ZIP without comments or multipart entries."
            )
        with zipfile.ZipFile(path) as archive:
            metadata = archive.getinfo("content.json")
            if metadata.flag_bits & 1 or metadata.compress_type not in {
                zipfile.ZIP_STORED,
                zipfile.ZIP_DEFLATED,
            }:
                raise ValidationError("Use an unencrypted standard ZIP backup.")
            if metadata.file_size > MAX_METADATA:
                raise ContentTooLargeError("The backup metadata exceeds 16 MB.")
            with archive.open(metadata) as file:
                raw = file.read(MAX_METADATA + 1)
            if len(raw) > MAX_METADATA:
                raise ContentTooLargeError("The backup metadata exceeds 16 MB.")
            data = BackupContent.model_validate_json(raw)
            validate_graph(data)
            return data
    except (
        OSError,
        ValueError,
        KeyError,
        zipfile.BadZipFile,
        SchemaError,
        RecursionError,
        struct.error,
        RuntimeError,
        zlib.error,
    ):
        raise ValidationError("Choose a valid Noted content backup ZIP.") from None


def copy_checked(source: IO[bytes], destination: IO[bytes], blob: BackupBlob) -> None:
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(65536):
        size += len(chunk)
        if size > blob.size:
            raise ValidationError("A backup file exceeds its declared size.")
        digest.update(chunk)
        destination.write(chunk)
    if size != blob.size or digest.hexdigest() != blob.sha256:
        raise ValidationError("A backup file is missing data or has changed.")


def validate_archive(path: Path, directory: Path) -> BackupContent:
    data = read_content(path)
    expected = {"content.json", *(item.path for item, _ in blobs(data))}
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) != len(expected) or {item.filename for item in entries} != expected:
                raise ValidationError("The backup has missing, duplicate, or unexpected files.")
            if sum(item.file_size for item in entries) > MAX_EXPANDED:
                raise ContentTooLargeError("The expanded backup exceeds 2 GB.")
            for entry in entries:
                if (
                    entry.flag_bits & 1
                    or entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                    or stat.S_ISLNK(entry.external_attr >> 16)
                ):
                    raise ValidationError("Encrypted or special ZIP entries are not supported.")
            directory.mkdir(mode=0o700, exist_ok=True)
            for blob, media_type in blobs(data):
                entry = archive.getinfo(blob.path)
                if entry.file_size != blob.size:
                    raise ValidationError("A backup file has the wrong size.")
                target = directory / blob.path.split("/")[1]
                with archive.open(entry) as source, target.open("xb") as destination:
                    copy_checked(source, destination, blob)
                if media_type and media_type.startswith("image/"):
                    with target.open("rb") as source:
                        actual = inspect_image(
                            UploadFile(source, headers=Headers({"content-type": media_type})), True
                        )
                    if actual != media_type:
                        raise ValidationError("A backup image does not match its file type.")
                elif media_type in VIDEO_TYPES:
                    with target.open("rb") as source:
                        if detect_video_type(source.read(4096)) != media_type:
                            raise ValidationError("A backup video does not match its file type.")
        return data
    except (OSError, zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError, zlib.error):
        raise ValidationError("The backup archive could not be verified.") from None
