from collections.abc import AsyncIterator
from tempfile import SpooledTemporaryFile
from typing import BinaryIO, cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.errors import NotFoundError
from app.notes.images.encoding import MAX_PREVIEW_BYTES, encode_preview
from app.notes.models import Attachment
from app.storage.base import FileStorage
from app.storage.media import IMAGE_TYPES


async def preview_bytes(data: bytes) -> AsyncIterator[bytes]:
    yield data


class ImagePreviewService:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage

    async def create(self, attachment: Attachment, source: BinaryIO) -> str:
        preview = await run_in_threadpool(encode_preview, source)
        identifier = uuid4().hex
        key = f"{identifier[:2]}/{identifier}"
        size = await self.storage.save(key, preview_bytes(preview.data), MAX_PREVIEW_BYTES)
        attachment.width = preview.width
        attachment.height = preview.height
        attachment.preview_storage_key = key
        attachment.preview_size = size
        attachment.preview_failed = False
        return key

    async def from_storage(self, attachment: Attachment) -> str:
        with SpooledTemporaryFile(max_size=1024 * 1024) as source:
            async for chunk in self.storage.read(attachment.storage_key):
                await run_in_threadpool(source.write, chunk)
            return await self.create(attachment, cast(BinaryIO, source))

    async def ensure(self, attachment: Attachment) -> Attachment:
        if attachment.content_type not in IMAGE_TYPES.values():
            raise NotFoundError("This file has no image preview")
        if attachment.preview_storage_key and await self.storage.exists(
            attachment.preview_storage_key
        ):
            return attachment

        def locked() -> Attachment:
            return self.db.scalars(
                select(Attachment)
                .where(Attachment.id == attachment.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).one()

        attachment = await run_in_threadpool(locked)
        if attachment.preview_storage_key and await self.storage.exists(
            attachment.preview_storage_key
        ):
            self.db.commit()
            return attachment
        key = await self.from_storage(attachment)
        try:
            self.db.commit()
        except BaseException:
            self.db.rollback()
            await self.storage.delete(key)
            raise
        return attachment
