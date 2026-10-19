from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.journals.models import JournalEntry


class JournalRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, channel_id: UUID, limit: int, offset: int) -> list[JournalEntry]:
        return list(
            self.db.scalars(
                select(JournalEntry)
                .where(JournalEntry.channel_id == channel_id)
                .order_by(JournalEntry.created_at.desc(), JournalEntry.id.desc())
                .limit(limit)
                .offset(offset)
            )
        )

    def get(self, entry_id: UUID, author_id: UUID, lock: bool = False) -> JournalEntry | None:
        statement = select(JournalEntry).where(
            JournalEntry.id == entry_id, JournalEntry.author_id == author_id
        )
        return self.db.scalar(statement.with_for_update() if lock else statement)
