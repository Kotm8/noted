from uuid import UUID

from sqlalchemy.orm import Session

from app.backup.schemas import BackupContent
from app.core.errors import ValidationError
from app.core.security import utc_now
from app.habits.models import Habit, HabitEntry
from app.habits.repository import HabitRepository
from app.habits.service import next_reminder


def validate_habits(data: BackupContent) -> None:
    if (data.habits or data.habit_entries) and data.version < 10:
        raise ValidationError("Habits require a version 10 backup")
    if len(data.habits) > 100:
        raise ValidationError("Keep up to 100 habits")
    activities = {item.id for item in data.activities}
    habits = {item.id for item in data.habits}
    if any(item.activity_id and item.activity_id not in activities for item in data.habits):
        raise ValidationError("A habit references an unknown activity")
    keys = [(item.habit_id, item.day) for item in data.habit_entries]
    if len(set(keys)) != len(keys) or any(
        item.habit_id not in habits for item in data.habit_entries
    ):
        raise ValidationError("The backup contains invalid habit progress")


def restore_habits(db: Session, owner_id: UUID, data: BackupContent, ids: dict[UUID, UUID]) -> None:
    if len(HabitRepository(db).all(owner_id)) + len(data.habits) > 100:
        raise ValidationError("Import exceeds the habit limit. Use Replace instead.")
    for item in data.habits:
        habit = Habit(
            id=ids[item.id],
            owner_id=owner_id,
            archived=False,
            **item.model_dump(exclude={"id", "activity_id"}),
            activity_id=ids[item.activity_id] if item.activity_id else None,
        )
        habit.next_reminder_at = next_reminder(habit, utc_now())
        db.add(habit)
    db.flush()
    for entry in data.habit_entries:
        db.add(HabitEntry(habit_id=ids[entry.habit_id], **entry.model_dump(exclude={"habit_id"})))
