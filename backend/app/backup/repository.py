from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import ContentTooLargeError
from app.notes.models import Attachment, Message
from app.reminders.models import Reminder
from app.workspaces.models import Category, Channel, Workspace

MAX_RECORDS = 50000


class BackupRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def content(self, owner_id: UUID) -> dict[str, list[dict[str, Any]]]:
        projects = select(Workspace.id).where(Workspace.owner_id == owner_id)
        channels = select(Channel.id).where(Channel.workspace_id.in_(projects))
        messages = select(Message.id).where(
            Message.channel_id.in_(channels), Message.deleted_at.is_(None)
        )
        text_size = (
            self.db.scalar(
                select(func.sum(func.octet_length(Message.content))).where(Message.id.in_(messages))
            )
            or 0
        )
        if text_size > 16 * 1024 * 1024:
            raise ContentTooLargeError("The message text exceeds the 16 MB content backup limit.")
        queries = {
            "workspaces": select(Workspace.__table__).where(Workspace.id.in_(projects)),
            "categories": select(Category.__table__).where(Category.workspace_id.in_(projects)),
            "channels": select(Channel.__table__).where(Channel.id.in_(channels)),
            "messages": select(Message.__table__).where(Message.id.in_(messages)),
            "attachments": select(Attachment.__table__).where(Attachment.message_id.in_(messages)),
            "reminders": select(Reminder.__table__).where(Reminder.message_id.in_(messages)),
        }
        result: dict[str, list[dict[str, Any]]] = {}
        total = 0
        for name, query in queries.items():
            rows = self.db.execute(query.limit(MAX_RECORDS + 1)).mappings().all()
            total += len(rows)
            if total > MAX_RECORDS:
                raise ContentTooLargeError("This content backup exceeds the 50,000 record limit.")
            result[name] = [dict(row) for row in rows]
        return result

    def clear(self, owner_id: UUID) -> None:
        self.db.execute(delete(Workspace).where(Workspace.owner_id == owner_id))
