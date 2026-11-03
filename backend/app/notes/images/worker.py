import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.notes.images.service import ImagePreviewService
from app.notes.models import Attachment, Message
from app.storage.base import FileStorage
from app.storage.media import IMAGE_TYPES

logger = logging.getLogger(__name__)


async def backfill_previews(engine: Engine, storage: FileStorage, limit: int = 2) -> int:
    processed = 0
    for _ in range(limit):
        with Session(engine) as db:
            attachment = db.scalar(
                select(Attachment)
                .join(Message)
                .where(
                    Attachment.content_type.in_(IMAGE_TYPES.values()),
                    Attachment.preview_storage_key.is_(None),
                    Attachment.preview_failed.is_(False),
                    Message.deleted_at.is_(None),
                )
                .order_by(Attachment.created_at, Attachment.id)
                .limit(1)
                .with_for_update(of=Attachment, skip_locked=True)
            )
            if attachment is None:
                break
            key = None
            try:
                key = await ImagePreviewService(db, storage).from_storage(attachment)
                db.commit()
            except Exception:
                db.rollback()
                if key:
                    await storage.delete(key)
                logger.warning(
                    "Could not create image preview for %s", attachment.id, exc_info=True
                )
                attachment.preview_failed = True
                db.commit()
            processed += 1
    return processed


async def image_preview_worker(engine: Engine, storage: FileStorage, settings: Settings) -> None:
    while True:
        try:
            if not (settings.maintenance_path and settings.maintenance_path.exists()):
                if await backfill_previews(engine, storage):
                    await asyncio.sleep(1)
                    continue
        except Exception:
            logger.exception("Image preview backfill failed")
        await asyncio.sleep(30)
