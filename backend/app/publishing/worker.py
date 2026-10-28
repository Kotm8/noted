import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.notes.models import Message
from app.publishing.models import ScheduledMessage, WritingDelivery, WritingPrompt
from app.publishing.recurrence import next_occurrence
from app.workspaces.models import Channel

logger = logging.getLogger(__name__)


def advance_due(
    engine: Engine,
    now: datetime,
    previous: datetime | None,
    max_gap: timedelta = timedelta(seconds=30),
) -> None:
    """Post due scheduled messages; a gap longer than max_gap means downtime, so skip."""
    skip = previous is None or now - previous > max_gap
    with Session(engine) as db:
        db.execute(text("SELECT pg_advisory_xact_lock(731492681)"))
        messages = db.scalars(
            select(ScheduledMessage)
            .where(ScheduledMessage.status == "pending", ScheduledMessage.send_at <= now)
            .order_by(ScheduledMessage.send_at, ScheduledMessage.id)
            .limit(100)
            .with_for_update(skip_locked=True)
        ).all()
        for item in messages:
            channel = db.get(Channel, item.channel_id)
            if (
                skip
                or (previous is not None and item.send_at <= previous)
                or channel is None
                or channel.kind != "note"
            ):
                item.status = "skipped"
            else:
                message = Message(
                    channel_id=item.channel_id,
                    author_id=item.owner_id,
                    content=item.content,
                    created_at=now,
                    updated_at=now,
                )
                db.add(message)
                db.flush()
                item.message_id = message.id
                item.status = "sent"
            item.revision += 1
        prompts = db.scalars(
            select(WritingPrompt)
            .where(WritingPrompt.enabled.is_(True), WritingPrompt.next_at <= now)
            .order_by(WritingPrompt.next_at, WritingPrompt.id)
            .limit(100)
            .with_for_update(skip_locked=True)
        ).all()
        for prompt in prompts:
            if not skip and previous is not None and prompt.next_at and prompt.next_at > previous:
                prompt.due_at = prompt.next_at
                prompt.revision += 1
            prompt.next_at = next_occurrence(prompt, now)
            db.execute(delete(WritingDelivery).where(WritingDelivery.prompt_id == prompt.id))
        db.commit()
