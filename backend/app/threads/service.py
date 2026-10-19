from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationError
from app.core.pagination import decode_message_cursor, encode_message_cursor
from app.core.security import utc_now
from app.notes.models import Message
from app.notes.schemas import MessageCreate, MessagePage, MessageResponse
from app.notes.services.messages import MessageService
from app.publishing.repository import complete_writing
from app.threads.repository import ThreadRepository
from app.threads.schemas import ThreadPage


class ThreadService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.messages = MessageService(db)
        self.repository = ThreadRepository(db)

    def root(self, root_id: UUID, owner_id: UUID, lock: bool = False) -> Message:
        root = self.messages.get_message(root_id, owner_id, lock)
        if root.thread_root_id is not None:
            raise ValidationError("Open the original note to reply to this thread.")
        return root

    def read(
        self,
        root_id: UUID,
        owner_id: UUID,
        before: str | None,
        limit: int,
        after: str | None = None,
        around: UUID | None = None,
    ) -> ThreadPage:
        root = self.root(root_id, owner_id)
        if sum(item is not None for item in (before, after, around)) > 1:
            raise ValidationError("Use one pagination direction at a time.")
        if after is not None:
            following = self.repository.list(
                root_id, None, limit + 1, after=decode_message_cursor(after)
            )
            items = following[:limit]
            return ThreadPage(
                root=self.messages.responses([root])[0],
                replies=MessagePage(
                    items=[MessageResponse.model_validate(item) for item in items],
                    next_cursor=None,
                    newer_cursor=encode_message_cursor(items[-1].created_at, items[-1].id)
                    if len(following) > limit
                    else None,
                ),
            )
        cursor = decode_message_cursor(before) if before else None
        if around is not None:
            anchor = self.messages.get_message(around, owner_id)
            if anchor.thread_root_id != root_id:
                raise NotFoundError("Reply not found in this thread")
            cursor = (anchor.created_at, anchor.id)
        replies = self.repository.list(
            root_id,
            cursor,
            limit + 1,
            include_boundary=around is not None,
        )
        more = len(replies) > limit
        replies = replies[:limit]
        return ThreadPage(
            root=self.messages.responses([root])[0],
            replies=MessagePage(
                items=[MessageResponse.model_validate(reply) for reply in reversed(replies)],
                next_cursor=encode_message_cursor(replies[-1].created_at, replies[-1].id)
                if more
                else None,
                newer_cursor=encode_message_cursor(replies[0].created_at, replies[0].id)
                if replies
                and self.repository.list(
                    root_id, None, 1, after=(replies[0].created_at, replies[0].id)
                )
                else None,
            ),
        )

    def reply(self, root_id: UUID, owner_id: UUID, data: MessageCreate) -> Message:
        root = self.root(root_id, owner_id, lock=True)
        if data.reminder is not None:
            raise ValidationError("Schedule reminders on channel notes.")
        reply = self.messages.repository.create(root.channel_id, owner_id, data.content, root_id)
        complete_writing(self.db, root.channel_id, utc_now())
        self.db.commit()
        self.db.refresh(reply)
        return reply
