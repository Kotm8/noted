import json
from datetime import date, datetime, timedelta
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import Settings
from app.habits.models import Habit, HabitDelivery, HabitReminder
from app.habits.service import HabitService, next_reminder
from app.notifications.routing import deliver
from app.notifications.schemas import NotificationSettings


def dispatch_habits(engine: Engine, settings: Settings, now: datetime) -> None:
    with Session(engine) as db:
        service = HabitService(db)
        progress_cache: dict[tuple[UUID, date], dict[UUID, float]] = {}

        def progress_value(habit: Habit, day: date) -> float:
            key = (habit.owner_id, day)
            if key not in progress_cache:
                progress_cache[key] = {
                    item.habit_id: item.value
                    for item in service.board(habit.owner_id, day, day).progress
                }
            return progress_cache[key][habit.id]

        habits = db.scalars(
            select(Habit)
            .where(Habit.archived.is_(False), Habit.next_reminder_at <= now)
            .order_by(Habit.next_reminder_at)
            .limit(100)
            .with_for_update(skip_locked=True)
        ).all()
        for habit in habits:
            due = habit.next_reminder_at
            assert due is not None
            day = due.astimezone(ZoneInfo(habit.timezone)).date()
            identity = uuid5(habit.id, day.isoformat())
            if due >= now - timedelta(hours=1) and db.get(HabitReminder, identity) is None:
                if progress_value(habit, day) < habit.goal:
                    db.add(
                        HabitReminder(
                            id=identity,
                            owner_id=habit.owner_id,
                            habit_id=habit.id,
                            day=day,
                            due_at=due,
                            revision=habit.revision,
                        )
                    )
            habit.next_reminder_at = next_reminder(habit, now)
        db.flush()
        pending = db.execute(
            select(HabitReminder, Habit, User)
            .join(Habit, Habit.id == HabitReminder.habit_id)
            .join(User, User.id == HabitReminder.owner_id)
            .where(HabitReminder.completed_at.is_(None))
            .order_by(HabitReminder.due_at)
            .limit(100)
            .with_for_update(of=HabitReminder, skip_locked=True)
        ).all()
        for reminder, habit, user in pending:
            if (
                habit.archived
                or habit.reminder_minute is None
                or reminder.day != now.astimezone(ZoneInfo(habit.timezone)).date()
                or reminder.due_at < now - timedelta(hours=1)
            ):
                reminder.completed_at = now
                reminder.revision += 1
                continue
            value = progress_value(habit, reminder.day)
            if value >= habit.goal:
                reminder.completed_at = now
                reminder.revision += 1
                continue
            preferences = NotificationSettings.model_validate(user.notification_preferences or {})
            if not preferences.enabled:
                continue
            payload = json.dumps(
                {
                    "kind": "habit",
                    "habitReminderId": str(reminder.id),
                    "habitId": str(habit.id),
                    "revision": reminder.revision,
                    "title": habit.name,
                    "body": "Not done yet"
                    if habit.kind == "check"
                    else f"{value:g} / {habit.goal:g} {habit.unit}",
                    "url": f"/habits?habit={habit.id}&day={reminder.day}",
                },
                ensure_ascii=False,
            )
            deliver(
                db,
                HabitDelivery,
                reminder.id,
                reminder.revision,
                user.id,
                preferences,
                payload,
                origin=settings.app_origin,
                settings=settings,
                max_attempts=4,
                ttl=3600,
            )
        db.commit()
