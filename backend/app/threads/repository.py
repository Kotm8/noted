from datetime import datetime
from uuid import UUID

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.notes.models import Message


class ThreadRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(
        self,
        root_id: UUID,
        before: tuple[datetime, UUID] | None,
        limit: int,
        after: tuple[datetime, UUID] | None = None,
        include_boundary: bool = False,
    ) -> list[Message]:
        statement = select(Message).where(
            Message.thread_root_id == root_id, Message.deleted_at.is_(None)
        )
        if before is not None:
            position = tuple_(Message.created_at, Message.id)
            statement = statement.where(
                position <= before if include_boundary else position < before
            )
        if after is not None:
            statement = statement.where(tuple_(Message.created_at, Message.id) > after)
        order = (
            (Message.created_at, Message.id)
            if after
            else (Message.created_at.desc(), Message.id.desc())
        )
        return list(self.db.scalars(statement.order_by(*order).limit(limit)))
