from typing import Any, Literal, cast
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.notes.models import Message
from app.schedule.models import SchedulePlan
from app.workspaces.models import Channel, Workspace

Topic = Literal[
    "notes",
    "journals",
    "document",
    "structure",
    "reminders",
    "schedule",
    "tracker",
    "prompts",
    "publishing",
    "settings",
    "sessions",
    "templates",
    "habits",
    "nutrition",
]


class LiveEvent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    topic: Topic
    user: UUID
    channel: UUID | None = None
    thread: UUID | None = None
    entry: UUID | None = None
    workspace: UUID | None = None
    settings: Literal["appearance", "notifications", "watch", "tracking", "server"] | None = None
    session: UUID | None = None
    revoked: bool = False

    def payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True, exclude_defaults=True)


TABLE_TOPICS: dict[str, Topic] = {
    "habits": "habits",
    "habit_entries": "habits",
    "habit_reminders": "habits",
    "nutrition_profiles": "nutrition",
    "nutrition_targets": "nutrition",
    "meals": "nutrition",
    "saved_meals": "nutrition",
    "weigh_ins": "nutrition",
    "meal_photos": "nutrition",
    "day_templates": "templates",
    "note_templates": "templates",
    "messages": "notes",
    "attachments": "notes",
    "journal_entries": "journals",
    "channel_documents": "document",
    "workspaces": "structure",
    "categories": "structure",
    "channels": "structure",
    "reminders": "reminders",
    "schedule_plans": "schedule",
    "schedule_exceptions": "schedule",
    "time_sessions": "schedule",
    "tracker_state": "tracker",
    "activities": "tracker",
    "plan_prompts": "prompts",
    "plan_prompt_events": "prompts",
    "scheduled_messages": "publishing",
    "writing_prompts": "publishing",
    "writing_nudges": "publishing",
    "sessions": "sessions",
}


def event_owner(db: Session, row: Any) -> UUID | None:
    for column in ("owner_id", "user_id", "author_id"):
        if value := getattr(row, column, None):
            return cast(UUID, value)
    if isinstance(row, User):
        return row.id
    if habit_id := getattr(row, "habit_id", None):
        from app.habits.models import Habit

        habit = db.get(Habit, habit_id)
        return habit.owner_id if habit else None
    if workspace := getattr(row, "workspace_id", None):
        parent = db.get(Workspace, workspace)
        if parent is not None:
            return parent.owner_id
    if channel := getattr(row, "channel_id", None):
        parent_channel = db.get(Channel, channel)
        if parent_channel is not None:
            return event_owner(db, parent_channel)
    if message := getattr(row, "message_id", None):
        parent_message = db.get(Message, message)
        if parent_message is not None:
            return parent_message.author_id
    if plan := getattr(row, "plan_id", None):
        parent_plan = db.get(SchedulePlan, plan)
        if parent_plan is not None:
            return parent_plan.owner_id
    return db.scalar(select(User.id).where(User.is_owner.is_(True)).limit(1))


def row_events(db: Session, row: Any) -> list[LiveEvent]:
    table = getattr(row, "__tablename__", "")
    if table not in TABLE_TOPICS and table != "users":
        return []
    owner = event_owner(db, row)
    if owner is None:
        return []
    if table == "users":
        state = inspect(row)
        return [
            LiveEvent(topic="settings", user=owner, settings=setting)
            for column, setting in (
                ("appearance", "appearance"),
                ("notification_preferences", "notifications"),
                ("watch_preferences", "watch"),
            )
            if state.attrs[column].history.has_changes()
        ]
    if table == "sessions":
        state = inspect(row)
        revoked = row in db.deleted or (
            state.attrs.revoked_at.history.has_changes() and row.revoked_at is not None
        )
        if not revoked and row not in db.new:
            return []
        return [
            LiveEvent(
                topic="sessions", user=owner, session=row.id if revoked else None, revoked=revoked
            )
        ]
    ids: dict[str, Any] = {}
    if channel := getattr(row, "channel_id", None):
        ids["channel"] = channel
    if table in {"messages", "attachments", "reminders"}:
        message = row if table == "messages" else db.get(Message, row.message_id)
        if message is not None:
            ids.update(channel=message.channel_id, thread=message.thread_root_id)
    if table == "journal_entries":
        ids["entry"] = row.id
    if table in {"workspaces", "categories", "channels"}:
        ids["workspace"] = row.id if table == "workspaces" else row.workspace_id
    events = [LiveEvent(topic=TABLE_TOPICS[table], user=owner, **ids)]
    if table in {"workspaces", "categories", "channels"} or (
        table == "messages" and row.reminder is not None
    ):
        events.append(LiveEvent(topic="reminders", user=owner, **ids))
    if table in {"activities", "time_sessions"}:
        events.append(LiveEvent(topic="tracker", user=owner))
        events.append(LiveEvent(topic="schedule", user=owner))
    return events
