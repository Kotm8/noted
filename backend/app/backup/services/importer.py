from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID, uuid4

import anyio
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.backup.repository import BackupRepository
from app.backup.schemas import BackupContent
from app.backup.services.archive import blobs
from app.backup.services.tracking import restore_tracking
from app.core.security import utc_now
from app.journals.models import JournalEntry
from app.notes.documents.models import ChannelDocument
from app.notes.models import Attachment, Message
from app.publishing.models import ScheduledMessage, WritingPrompt
from app.publishing.recurrence import next_occurrence
from app.reminders.models import Reminder
from app.storage.base import FileStorage
from app.workspaces.models import Category, Channel, Workspace


async def file_chunks(path: Path) -> AsyncIterator[bytes]:
    async with await anyio.open_file(path, "rb") as file:
        while chunk := await file.read(65536):
            yield chunk


class BackupImporter:
    def __init__(self, db: Session, storage: FileStorage) -> None:
        self.db = db
        self.storage = storage

    async def restore(
        self, data: BackupContent, directory: Path, owner_id: UUID, replace: bool
    ) -> None:
        identifiers = {
            item.id: uuid4()
            for group in (
                data.workspaces,
                data.categories,
                data.channels,
                data.messages,
                data.attachments,
                data.journals,
                data.activities,
                data.time_sessions,
                data.schedule_plans,
                data.plan_events,
                data.scheduled_messages,
                data.writing_prompts,
            )
            for item in group
        }
        keys: dict[str, str] = {}
        created: list[str] = []
        try:
            self.db.execute(text("SELECT pg_advisory_xact_lock(731492681)"))
            for blob, _ in blobs(data):
                identifier = uuid4().hex
                key = f"{identifier[:2]}/{identifier}"
                created.append(key)
                size = await self.storage.save(
                    key, file_chunks(directory / blob.path.split("/")[1]), blob.size
                )
                if size != blob.size:
                    raise ValueError("The staged backup file changed")
                keys[blob.path] = key
            restore_tracking(self.db, owner_id, data, identifiers, replace)
            if replace:
                BackupRepository(self.db).clear(owner_id)
            for item in data.workspaces:
                self.db.add(
                    Workspace(
                        id=identifiers[item.id],
                        owner_id=owner_id,
                        name=item.name,
                        icon=item.icon,
                        position=item.position,
                        created_at=item.created_at,
                        icon_storage_key=keys[item.image.path] if item.image else None,
                        icon_content_type=item.image_type,
                        icon_size=item.image.size if item.image else None,
                    )
                )
            self.db.flush()
            for category in data.categories:
                self.db.add(
                    Category(
                        id=identifiers[category.id],
                        workspace_id=identifiers[category.workspace_id],
                        name=category.name,
                        position=category.position,
                    )
                )
            self.db.flush()
            for channel in data.channels:
                self.db.add(
                    Channel(
                        id=identifiers[channel.id],
                        workspace_id=identifiers[channel.workspace_id],
                        category_id=identifiers[channel.category_id]
                        if channel.category_id
                        else None,
                        name=channel.name,
                        kind=channel.kind,
                        position=channel.position,
                        created_at=channel.created_at,
                        banner_storage_key=keys[channel.image.path] if channel.image else None,
                        banner_content_type=channel.image_type,
                        banner_size=channel.image.size if channel.image else None,
                    )
                )
            self.db.flush()
            for replies in (False, True):
                for message in data.messages:
                    if bool(message.thread_root_id) != replies:
                        continue
                    self.db.add(
                        Message(
                            id=identifiers[message.id],
                            channel_id=identifiers[message.channel_id],
                            author_id=owner_id,
                            content=message.content,
                            thread_root_id=identifiers[message.thread_root_id]
                            if message.thread_root_id
                            else None,
                            created_at=message.created_at,
                            updated_at=message.updated_at,
                        )
                    )
                self.db.flush()
            for entry in data.journals:
                self.db.add(
                    JournalEntry(
                        id=identifiers[entry.id],
                        channel_id=identifiers[entry.channel_id],
                        author_id=owner_id,
                        title=entry.title,
                        content=entry.content,
                        revision=entry.revision,
                        created_at=entry.created_at,
                        updated_at=entry.updated_at,
                    )
                )
            for document in data.documents:
                self.db.add(
                    ChannelDocument(
                        channel_id=identifiers[document.channel_id],
                        **document.model_dump(exclude={"channel_id"}),
                    )
                )
            for attachment in data.attachments:
                self.db.add(
                    Attachment(
                        id=identifiers[attachment.id],
                        message_id=identifiers[attachment.message_id],
                        original_filename=attachment.filename,
                        storage_key=keys[attachment.file.path],
                        content_type=attachment.content_type,
                        size=attachment.file.size,
                        position=attachment.position,
                        created_at=attachment.created_at,
                    )
                )
            for message in data.messages:
                if message.reminder:
                    self.db.add(
                        Reminder(
                            message_id=identifiers[message.id], **message.reminder.model_dump()
                        )
                    )
            for queued in data.scheduled_messages:
                fields = queued.model_dump(exclude={"id", "channel_id"})
                if queued.status == "pending" and queued.send_at <= utc_now():
                    fields["status"] = "skipped"
                self.db.add(
                    ScheduledMessage(
                        id=identifiers[queued.id],
                        channel_id=identifiers[queued.channel_id],
                        owner_id=owner_id,
                        **fields,
                    )
                )
            for rule in data.writing_prompts:
                self.db.add(
                    WritingPrompt(
                        id=identifiers[rule.id],
                        channel_id=identifiers[rule.channel_id],
                        owner_id=owner_id,
                        next_at=next_occurrence(rule, utc_now()),
                        **rule.model_dump(exclude={"id", "channel_id"}),
                    )
                )
            self.db.commit()
        except BaseException:
            self.db.rollback()
            for key in created:
                await self.storage.delete(key)
            raise
