from datetime import datetime
from uuid import UUID

from sqlalchemy import case, select, update
from sqlalchemy.orm import Session

from app.publishing.models import ScheduledMessage, WritingPrompt


class PublishingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def messages(self, channel_id: UUID) -> list[ScheduledMessage]:
        return list(
            self.db.scalars(
                select(ScheduledMessage)
                .where(ScheduledMessage.channel_id == channel_id)
                .order_by(
                    (ScheduledMessage.status == "pending").desc(),
                    case((ScheduledMessage.status == "pending", ScheduledMessage.send_at)).asc(),
                    ScheduledMessage.send_at.desc(),
                )
                .limit(200)
            )
        )

    def prompt(self, channel_id: UUID, lock: bool = False) -> WritingPrompt | None:
        query = select(WritingPrompt).where(WritingPrompt.channel_id == channel_id)
        return self.db.scalar(query.with_for_update() if lock else query)


def complete_writing(db: Session, channel_id: UUID, now: datetime) -> None:
    db.execute(
        update(WritingPrompt)
        .where(WritingPrompt.channel_id == channel_id, WritingPrompt.due_at <= now)
        .values(due_at=None)
    )
