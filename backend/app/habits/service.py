from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.core.security import utc_now
from app.habits.models import Habit, HabitEntry, HabitReminder
from app.habits.repository import HabitRepository
from app.habits.schemas import (
    HabitBoard,
    HabitFields,
    HabitProgress,
    HabitResponse,
    HabitUpdate,
    ProgressInput,
)
from app.time_tracking.models import TimeSession
from app.time_tracking.repository import TrackingRepository


def next_reminder(habit: Habit, after: datetime) -> datetime | None:
    if habit.archived or habit.reminder_minute is None:
        return None
    zone = ZoneInfo(habit.timezone)
    start = max(
        habit.starts_on, habit.reminder_start or habit.starts_on, after.astimezone(zone).date()
    )
    for offset in range(15):
        day = start + timedelta(days=offset)
        if day.weekday() not in habit.weekdays:
            continue
        wall = datetime.combine(day, time(habit.reminder_minute // 60, habit.reminder_minute % 60))
        candidate = wall.replace(tzinfo=zone).astimezone(UTC)
        if candidate.astimezone(zone).replace(tzinfo=None) == wall and candidate > after:
            return candidate
    return None


class HabitService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = HabitRepository(db)

    def add(self, owner_id: UUID, data: HabitFields) -> Habit:
        TrackingRepository(self.db).lock(owner_id)
        if len(self.repository.all(owner_id)) >= 100:
            raise ValidationError("Keep up to 100 habits")
        if data.activity_id:
            TrackingRepository(self.db).activity(owner_id, data.activity_id)
        habit = Habit(owner_id=owner_id, **data.model_dump(), archived=False, revision=1)
        habit.next_reminder_at = next_reminder(habit, utc_now())
        self.db.add(habit)
        self.db.flush()
        return habit

    def edit(self, owner_id: UUID, habit_id: UUID, data: HabitUpdate) -> Habit:
        habit = self.repository.get(owner_id, habit_id)
        if habit.revision != data.revision:
            raise ConflictError("This habit changed on another device. Reload before editing.")
        if data.activity_id:
            TrackingRepository(self.db).activity(owner_id, data.activity_id)
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(habit, key, value)
        habit.revision += 1
        habit.next_reminder_at = next_reminder(habit, utc_now())
        self.dismiss(habit.id)
        self.db.flush()
        return habit

    def dismiss(self, habit_id: UUID) -> None:
        self.db.execute(
            update(HabitReminder)
            .where(HabitReminder.habit_id == habit_id, HabitReminder.completed_at.is_(None))
            .values(completed_at=utc_now(), revision=HabitReminder.revision + 1)
        )

    def remove(self, owner_id: UUID, habit_id: UUID, revision: int) -> None:
        habit = self.repository.get(owner_id, habit_id)
        if habit.revision != revision:
            raise ConflictError("This habit changed. Reload before deleting.")
        habit.archived = True
        habit.revision += 1
        habit.next_reminder_at = None
        self.dismiss(habit.id)

    def progress(self, owner_id: UUID, habit_id: UUID, data: ProgressInput) -> HabitProgress:
        habit = self.repository.get(owner_id, habit_id)
        if habit.activity_id:
            raise ValidationError("Linked progress comes from tracked activity")
        if (
            data.day > utc_now().astimezone(ZoneInfo(habit.timezone)).date()
            or data.day < habit.starts_on
            or data.day.weekday() not in habit.weekdays
        ):
            raise ValidationError("Choose a scheduled day up to today")
        entry = self.db.get(HabitEntry, (habit.id, data.day))
        if (entry.revision if entry else 0) != data.revision:
            raise ConflictError("Progress changed on another device. Reload first.")
        if entry is None:
            entry = HabitEntry(habit_id=habit.id, day=data.day, value=data.value, revision=1)
            self.db.add(entry)
        else:
            entry.value = data.value
            entry.revision += 1
        if data.value >= habit.goal:
            self.db.execute(
                update(HabitReminder)
                .where(
                    HabitReminder.habit_id == habit.id,
                    HabitReminder.day == data.day,
                    HabitReminder.completed_at.is_(None),
                )
                .values(completed_at=utc_now(), revision=HabitReminder.revision + 1)
            )
        self.db.flush()
        return HabitProgress(
            habit_id=habit.id, day=data.day, value=entry.value, revision=entry.revision, due=True
        )

    def board(self, owner_id: UUID, start: date, end: date) -> HabitBoard:
        if not 0 <= (end - start).days <= 31:
            raise ValidationError("Choose up to 32 days")
        habits = self.repository.all(owner_id)
        entries = {
            (item.habit_id, item.day): item
            for item in self.db.scalars(
                select(HabitEntry)
                .join(Habit)
                .where(Habit.owner_id == owner_id, HabitEntry.day >= start, HabitEntry.day <= end)
            )
        }
        lower = datetime.combine(start - timedelta(days=1), time(), UTC)
        upper = datetime.combine(end + timedelta(days=2), time(), UTC)
        sessions = list(
            self.db.scalars(
                select(TimeSession).where(
                    TimeSession.owner_id == owner_id,
                    TimeSession.started_at < upper,
                    or_(TimeSession.ended_at.is_(None), TimeSession.ended_at > lower),
                )
            )
        )
        now = utc_now()
        result = []
        for habit in habits:
            zone = ZoneInfo(habit.timezone)
            for offset in range((end - start).days + 1):
                day = start + timedelta(days=offset)
                entry = entries.get((habit.id, day))
                value = entry.value if entry else 0
                if habit.activity_id:
                    day_start = datetime.combine(day, time(), zone).astimezone(UTC)
                    day_end = datetime.combine(day + timedelta(days=1), time(), zone).astimezone(
                        UTC
                    )
                    value = round(
                        sum(
                            max(
                                0,
                                (
                                    min(item.ended_at or now, day_end, now)
                                    - max(item.started_at, day_start)
                                ).total_seconds(),
                            )
                            for item in sessions
                            if item.activity_id == habit.activity_id
                        )
                        / 60,
                        2,
                    )
                result.append(
                    HabitProgress(
                        habit_id=habit.id,
                        day=day,
                        value=value,
                        revision=entry.revision if entry else 0,
                        due=day >= habit.starts_on and day.weekday() in habit.weekdays,
                    )
                )
        return HabitBoard(
            habits=[HabitResponse.model_validate(item) for item in habits], progress=result
        )
