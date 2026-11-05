from typing import Any
from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.backup.schemas import BackupContent
from app.core.errors import ConflictError, ValidationError
from app.habits.models import Habit
from app.live import mark
from app.schedule.models import ScheduleException, SchedulePlan
from app.schedule.prompts.models import PlanPromptEvent
from app.schedule.recurrence import occurs_on
from app.time_tracking.models import Activity, TimeSession
from app.time_tracking.repository import TrackingRepository
from app.writing_nudges.models import WritingNudge, WritingNudgeRun
from app.writing_nudges.schemas import WritingNudgeSettings


def validate_tracking(data: BackupContent) -> None:
    channels = {item.id for item in data.channels}
    for config in [
        *[item.writing_nudge for item in data.activities],
        *[item.writing_nudge for item in data.schedule_plans],
        *[item.writing_nudge for item in data.schedule_exceptions],
    ]:
        if config is not None:
            if data.version < 8:
                raise ValidationError("Writing nudges require a version 8 backup")
            if config.channel_id is not None and config.channel_id not in channels:
                raise ValidationError("A writing nudge references an unknown channel")
    if data.version < 3 and (
        data.activities or data.time_sessions or data.schedule_plans or data.schedule_exceptions
    ):
        raise ValidationError("Time tracking and schedules require a version 3 backup")
    activities = {item.id for item in data.activities}
    plans = {item.id: item for item in data.schedule_plans}
    if data.plan_events and data.version < 4:
        raise ValidationError("Task prompt history requires a version 4 backup")
    if any(
        event.plan_id not in plans
        or (event.activity_id is not None and event.activity_id not in activities)
        for event in data.plan_events
    ):
        raise ValidationError("Task prompt history references an unknown plan or activity")
    if (
        len(activities) > 100
        or len(plans) > 1000
        or len({item.name.lower() for item in data.activities}) != len(data.activities)
    ):
        raise ValidationError("The backup exceeds activity or schedule limits, or repeats names")
    if any(
        identifier not in activities
        for identifier in [
            *[item.activity_id for item in data.time_sessions],
            *[item.activity_id for item in data.schedule_plans],
            *[item.activity_id for item in data.schedule_exceptions],
        ]
    ):
        raise ValidationError("The backup references an unknown activity")
    exceptions = {(item.plan_id, item.occurrence_date) for item in data.schedule_exceptions}
    if len(exceptions) != len(data.schedule_exceptions):
        raise ValidationError("The backup repeats an occurrence exception")
    for item in data.schedule_exceptions:
        plan = plans.get(item.plan_id)
        if plan is None or plan.frequency == "none" or not occurs_on(plan, item.occurrence_date):
            raise ValidationError("The backup contains an invalid repeating occurrence")
    previous = None
    for session in sorted(data.time_sessions, key=lambda item: item.started_at):
        if session.ended_at <= session.started_at or (previous and session.started_at < previous):
            raise ValidationError("The backup contains invalid or overlapping recorded sessions")
        previous = session.ended_at


def restore_tracking(
    db: Session, owner_id: UUID, data: BackupContent, ids: dict[UUID, UUID], replace: bool
) -> None:
    repository = TrackingRepository(db)
    state = repository.lock(owner_id)
    existing = repository.activities(owner_id)
    if replace:
        mark(db, "tracker", user=owner_id)
        mark(db, "schedule", user=owner_id)
        mark(db, "prompts", user=owner_id)
        state.paused_activity_id = None
        state.elapsed_seconds = 0
        state.last_request_id = None
        state.revision += 1
        db.flush()
        db.execute(delete(WritingNudgeRun).where(WritingNudgeRun.owner_id == owner_id))
        db.execute(delete(WritingNudge).where(WritingNudge.owner_id == owner_id))
        db.execute(delete(TimeSession).where(TimeSession.owner_id == owner_id))
        db.execute(delete(SchedulePlan).where(SchedulePlan.owner_id == owner_id))
        db.execute(delete(Habit).where(Habit.owner_id == owner_id))
        mark(db, "habits", user=owner_id)
        db.execute(delete(Activity).where(Activity.owner_id == owner_id))
        existing = []
    elif data.time_sessions:
        for session in data.time_sessions:
            overlap = db.scalar(
                select(TimeSession.id)
                .where(
                    TimeSession.owner_id == owner_id,
                    TimeSession.started_at < session.ended_at,
                    or_(TimeSession.ended_at.is_(None), TimeSession.ended_at > session.started_at),
                )
                .limit(1)
            )
            if overlap:
                raise ConflictError(
                    "Imported time overlaps existing history. Use Replace to restore this backup."
                )
    plan_count = len(
        list(
            db.scalars(
                select(SchedulePlan.id).where(
                    SchedulePlan.owner_id == owner_id, SchedulePlan.deleted_at.is_(None)
                )
            )
        )
    )
    if len(existing) + len(data.activities) > 100 or plan_count + len(data.schedule_plans) > 1000:
        raise ValidationError("Import exceeds the activity or plan limit. Use Replace instead.")
    names = {item.name.lower() for item in existing}
    position = max((item.position for item in existing), default=-1) + 1
    for item in data.activities:
        name = item.name
        suffix = 1
        while name.lower() in names:
            suffix += 1
            name = f"{item.name[:45]} (imported {suffix})"
        names.add(name.lower())
        db.add(
            Activity(
                id=ids[item.id],
                owner_id=owner_id,
                **(
                    item.model_dump(exclude={"id", "name", "position", "writing_nudge"})
                    | {"writing_nudge": remap_nudge(item.writing_nudge, ids)}
                    | {"name": name, "position": position}
                ),
            )
        )
        position += 1
    db.flush()
    for session_record in data.time_sessions:
        db.add(
            TimeSession(
                id=ids[session_record.id],
                owner_id=owner_id,
                activity_id=ids[session_record.activity_id],
                **session_record.model_dump(exclude={"id", "activity_id"}),
            )
        )
    for plan in data.schedule_plans:
        db.add(
            SchedulePlan(
                id=ids[plan.id],
                owner_id=owner_id,
                activity_id=ids[plan.activity_id],
                **plan.model_dump(exclude={"id", "activity_id", "writing_nudge"}),
                writing_nudge=remap_nudge(plan.writing_nudge, ids),
            )
        )
    db.flush()
    for exception in data.schedule_exceptions:
        db.add(
            ScheduleException(
                plan_id=ids[exception.plan_id],
                activity_id=ids[exception.activity_id],
                **exception.model_dump(exclude={"plan_id", "activity_id", "writing_nudge"}),
                writing_nudge=remap_nudge(exception.writing_nudge, ids),
            )
        )

    db.flush()
    for event in data.plan_events:
        db.add(
            PlanPromptEvent(
                id=ids[event.id],
                plan_id=ids[event.plan_id],
                activity_id=ids[event.activity_id] if event.activity_id else None,
                **event.model_dump(exclude={"id", "plan_id", "activity_id"}),
            )
        )


def remap_nudge(
    settings: WritingNudgeSettings | None, ids: dict[UUID, UUID]
) -> dict[str, Any] | None:
    if settings is None:
        return None
    result = settings.model_dump(mode="json")
    if settings.channel_id is not None:
        result["channel_id"] = str(ids[settings.channel_id])
    return result


def tracking_document(rows: dict[str, list[dict[str, Any]]], now: str) -> dict[str, Any]:
    fields = {
        "activities": (
            "id",
            "name",
            "icon",
            "color",
            "position",
            "archived",
            "revision",
            "writing_nudge",
        ),
        "time_sessions": ("id", "activity_id", "started_at", "ended_at", "revision"),
        "plan_events": (
            "id",
            "plan_id",
            "occurrence_date",
            "created_at",
            "action",
            "minutes",
            "reason",
            "activity_id",
        ),
        "schedule_plans": (
            "id",
            "activity_id",
            "title",
            "date",
            "start_minute",
            "end_minute",
            "timezone",
            "notifications_enabled",
            "notification_minutes",
            "writing_nudge",
            "frequency",
            "weekdays",
            "repeat_until",
            "revision",
        ),
        "schedule_exceptions": (
            "plan_id",
            "occurrence_date",
            "activity_id",
            "title",
            "date",
            "start_minute",
            "end_minute",
            "timezone",
            "deleted",
            "notifications_enabled",
            "notification_minutes",
            "writing_nudge",
        ),
    }
    result: dict[str, Any] = {
        key: [{field: row[field] for field in columns} for row in rows[key]]
        for key, columns in fields.items()
    }
    for session in result["time_sessions"]:
        if session["ended_at"] is None:
            session["ended_at"] = now
    for name in ("activities", "schedule_plans", "schedule_exceptions"):
        for record in result[name]:
            if record["writing_nudge"] is None:
                record.pop("writing_nudge")
            elif record["writing_nudge"].get("channel_id") not in {
                str(row["id"]) for row in rows["channels"]
            }:
                record["writing_nudge"] = {
                    **record["writing_nudge"],
                    "enabled": False,
                    "channel_id": None,
                }
    return result
