import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, selectinload

from app.notes.models import Attachment, Message
from app.notes.schemas import AttachmentResponse
from app.workspaces.services.channels import ChannelService


class LibraryItem(BaseModel):
    id: UUID
    thread_root_id: UUID | None
    content: str
    created_at: datetime
    attachments: list[AttachmentResponse]
    links: list[str]


class LibraryPage(BaseModel):
    items: list[LibraryItem]
    next_offset: int | None


def channel_library(db: Session, owner_id: UUID, channel_id: UUID, offset: int) -> LibraryPage:
    ChannelService(db).get_channel(channel_id, owner_id)
    root = Message.__table__.alias("library_root")
    rows = list(
        db.scalars(
            select(Message)
            .options(selectinload(Message.attachments))
            .where(
                Message.channel_id == channel_id,
                Message.deleted_at.is_(None),
                or_(
                    Message.thread_root_id.is_(None),
                    exists(
                        select(root.c.id).where(
                            root.c.id == Message.thread_root_id, root.c.deleted_at.is_(None)
                        )
                    ),
                ),
                or_(
                    exists(select(Attachment.id).where(Attachment.message_id == Message.id)),
                    Message.content.op("~*")(r"https?://"),
                ),
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .offset(offset)
            .limit(51)
        )
    )
    return LibraryPage(
        items=[
            LibraryItem(
                id=row.id,
                thread_root_id=row.thread_root_id,
                content=row.content,
                created_at=row.created_at,
                attachments=[AttachmentResponse.model_validate(file) for file in row.attachments],
                links=list(
                    dict.fromkeys(
                        re.findall(r"https?://[^\s<>\[\]\"\)]+", row.content, re.IGNORECASE)
                    )
                ),
            )
            for row in rows[:50]
        ],
        next_offset=offset + 50 if len(rows) > 50 else None,
    )
