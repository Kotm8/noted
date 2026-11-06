from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.habits.models import HabitReminder
from app.notes.models import Message
from app.publishing.models import WritingPrompt
from app.reminders.models import Reminder
from app.schedule.prompts.models import PlanPrompt
from app.schedule.prompts.service import refresh_prompts
from app.writing_nudges.models import WritingNudge


def current(db: Session, owner: UUID, kind: str, identifier: UUID, revision: int) -> bool:
    if kind == "reminder":
        message = db.get(Message, identifier)
        item = db.get(Reminder, identifier)
        return bool(
            message
            and message.author_id == owner
            and message.deleted_at is None
            and item
            and item.revision == revision
            and item.status == "active"
            and item.due_at <= utc_now()
            and item.read_revision < revision
        )
    if kind == "plan":
        prompt = db.get(PlanPrompt, identifier)
        return bool(
            prompt
            and prompt.owner_id == owner
            and prompt.revision == revision
            and prompt.status == "pending"
            and prompt.notify_at <= utc_now()
            and prompt.read_revision < revision
        )
    rows: list[HabitReminder | WritingPrompt | WritingNudge | None] = (
        [db.get(HabitReminder, identifier)]
        if kind == "habit"
        else [db.get(WritingPrompt, identifier), db.get(WritingNudge, identifier)]
        if kind == "writing"
        else []
    )
    for row in rows:
        if (
            row
            and row.owner_id == owner
            and row.revision == revision
            and row.read_revision < revision
        ):
            if isinstance(row, WritingPrompt):
                return row.enabled and row.due_at is not None
            return row.completed_at is None
    return False


def stale_notifications(db: Session, owner: UUID, items: list[str]) -> list[str]:
    if any(item.startswith("plan:") for item in items):
        refresh_prompts(db, owner)
        db.flush()
    stale = []
    for token in items:
        try:
            kind, identifier, revision = token.split(":")
            valid = current(db, owner, kind, UUID(identifier), int(revision))
        except (ValueError, TypeError):
            valid = False
        if not valid:
            stale.append(token)
    db.commit()
    return stale
