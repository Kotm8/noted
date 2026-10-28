from uuid import UUID

from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.core.errors import ContentTooLargeError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.core.storage_limits import MAX_BATCH_SIZE, MAX_FILES
from app.notes.models import Attachment, Message
from app.notes.repository import AttachmentRepository, MessageRepository
from app.notes.services.messages import MessageService, channel_content
from app.publishing.repository import complete_writing
from app.reminders.schemas import ReminderSchedule
from app.reminders.service import attach_reminder
from app.storage.base import FileStorage
from app.storage.uploads import UploadService
from app.workspaces.services.channels import ChannelService


class AttachmentService:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage
        self.attachments = AttachmentRepository(db)
        self.messages = MessageRepository(db)
        self.uploads = UploadService(storage)

    async def create_message(
        self,
        channel_id: UUID,
        owner_id: UUID,
        content: str,
        files: list[UploadFile],
        reminder: ReminderSchedule | None = None,
    ) -> Message:
        channel = ChannelService(self.db).get_channel(channel_id, owner_id)
        content = channel_content(channel, content)
        if not files or len(files) > MAX_FILES:
            raise ValidationError(f"Choose between 1 and {MAX_FILES} files.")
        if len(content) > 40000:
            raise ValidationError("Notes must be no longer than 40,000 characters.")

        saved_keys: list[str] = []
        total_size = 0
        try:
            message = self.messages.create(channel_id, owner_id, content)
            attach_reminder(self.db, message, reminder)
            for position, file in enumerate(files):
                saved = await self.uploads.save(file)
                saved_keys.append(saved.key)
                total_size += saved.size
                if total_size > MAX_BATCH_SIZE:
                    limit = MAX_BATCH_SIZE // (1024 * 1024)
                    raise ContentTooLargeError(f"Attachments must total no more than {limit} MB.")
                self.attachments.create(
                    message.id, saved.filename, saved.key, saved.content_type, saved.size, position
                )
            complete_writing(self.db, channel_id, utc_now())
            self.db.commit()
        except BaseException:
            self.db.rollback()
            for key in saved_keys:
                await self.storage.delete(key)
            raise
        self.db.refresh(message)
        return message

    async def get_attachment(self, attachment_id: UUID, owner_id: UUID) -> Attachment:
        attachment = self.attachments.get_by_id(attachment_id)
        if attachment is None:
            raise NotFoundError("Attachment not found")
        MessageService(self.db).get_message(attachment.message_id, owner_id)
        if not await self.storage.exists(attachment.storage_key):
            raise NotFoundError("The attachment file is missing from storage")
        return attachment
