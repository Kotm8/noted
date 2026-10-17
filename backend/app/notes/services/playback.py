from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.notes.models import Attachment
from app.notes.services.attachments import AttachmentService
from app.storage.base import FileStorage
from app.storage.media import VIDEO_TYPES, detect_video_type, has_video_playback


@dataclass(frozen=True)
class PlayableAttachment:
    attachment: Attachment
    content_type: str


class PlaybackService:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.attachments = AttachmentService(db, storage)
        self.storage = storage

    async def get(self, attachment_id: UUID, owner_id: UUID) -> PlayableAttachment:
        attachment = await self.attachments.get_attachment(attachment_id, owner_id)
        content_type = attachment.content_type
        if content_type not in VIDEO_TYPES and has_video_playback(
            content_type, attachment.original_filename
        ):
            header = b"".join(
                [chunk async for chunk in self.storage.read(attachment.storage_key, 0, 4096)]
            )
            content_type = detect_video_type(header) or "application/octet-stream"
        if content_type not in VIDEO_TYPES:
            raise NotFoundError("This file has no video playback.")
        return PlayableAttachment(attachment, content_type)
