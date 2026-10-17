from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import uuid4

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError, ValidationError
from app.core.storage_limits import MAX_FILE_SIZE, MAX_ICON_SIZE
from app.storage.base import FileStorage
from app.storage.media import inspect_media


@dataclass(frozen=True)
class StoredUpload:
    key: str
    filename: str
    content_type: str
    size: int


async def upload_chunks(upload: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await upload.read(65536):
        yield chunk


class UploadService:
    def __init__(self, storage: FileStorage) -> None:
        self.storage = storage

    async def save(self, upload: UploadFile, image_only: bool = False) -> StoredUpload:
        maximum = MAX_ICON_SIZE if image_only else MAX_FILE_SIZE
        if upload.size is not None and upload.size > maximum:
            limit = maximum // (1024 * 1024)
            raise ContentTooLargeError(f"Files must be no larger than {limit} MB.")
        if upload.size == 0:
            raise ValidationError("Empty files cannot be uploaded.")

        try:
            content_type = await run_in_threadpool(inspect_media, upload, image_only)
        finally:
            await upload.seek(0)

        identifier = uuid4().hex
        key = f"{identifier[:2]}/{identifier}"
        size = await self.storage.save(key, upload_chunks(upload), maximum)
        filename = (upload.filename or "attachment").replace("\\", "/").split("/")[-1]
        filename = "".join(character for character in filename if character.isprintable())[:255]
        return StoredUpload(key, filename or "attachment", content_type, size)
