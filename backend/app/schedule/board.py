from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ContentTooLargeError, ValidationError
from app.core.security import utc_now
from app.notes.models import Message
from app.reminders.models import Reminder
from app.schedule.recurrence import instants, occurs_on
from app.schedule.repository import ScheduleRepository
from app.schedule.schemas import PlanCreate, PlanFields, PlanOccurrence, ReminderFlag, ScheduleBoard
from app.time_tracking.repository import TrackingRepository
from app.time_tracking.schemas import SessionResponse
from app.workspaces.models import Channel, Workspace


def schedule_board(db: Session, owner_id: UUID, start: datetime, end: datetime) -> ScheduleBoard:
    if (
        start.tzinfo is None
        or end.tzinfo is None
        or end <= start
        or end - start > timedelta(days=35)
    ):
        raise ValidationError("Choose an aware date range of up to 35 days")
    repository = ScheduleRepository(db)
    plans = repository.plans(owner_id)
    if len(plans) > 1000:
        raise ContentTooLargeError("The schedule has too many plans")
    exceptions = repository.exceptions([item.id for item in plans])
    overrides = {(item.plan_id, item.occurrence_date): item for item in exceptions}
    occurrences: list[PlanOccurrence] = []
    for item in plans:
        plan = PlanCreate.model_validate(item, from_attributes=True)
        first = start.astimezone(ZoneInfo(plan.timezone)).date() - timedelta(days=1)
        last = end.astimezone(ZoneInfo(plan.timezone)).date()
        day = max(first, plan.date)
        dates = set()
        while day <= last:
            if occurs_on(plan, day):
                dates.add(day)
            day += timedelta(days=1)
        dates.update(
            exception.occurrence_date
            for exception in exceptions
            if exception.plan_id == item.id and first <= exception.date <= last
        )
        for day in sorted(dates):
            override = overrides.get((item.id, day))
            if override and override.deleted:
                continue
            fields = (
                PlanFields.model_validate(override, from_attributes=True)
                if override
                else PlanFields.model_validate(plan.model_dump() | {"date": day})
            )
            times = instants(fields, fields.date)
            if times is None or times[1] <= start or times[0] >= end:
                continue
            occurrences.append(
                PlanOccurrence(
                    **(plan.model_dump() | fields.model_dump()),
                    id=item.id,
                    revision=item.revision,
                    occurrence_date=day,
                    start_at=times[0],
                    end_at=times[1],
                    is_override=override is not None,
                )
            )
    sessions = TrackingRepository(db).sessions(owner_id, start, end)
    reminders = (
        db.execute(
            select(
                Reminder.due_at,
                Reminder.revision,
                Message.id.label("message_id"),
                Message.channel_id,
                func.left(Message.content, 500).label("content"),
                Channel.name.label("channel_name"),
                Workspace.id.label("workspace_id"),
                Workspace.name.label("workspace_name"),
            )
            .join(Message, Message.id == Reminder.message_id)
            .join(Channel, Channel.id == Message.channel_id)
            .join(Workspace, Workspace.id == Channel.workspace_id)
            .where(
                Workspace.owner_id == owner_id,
                Message.deleted_at.is_(None),
                Reminder.status == "active",
                Reminder.due_at >= max(start, utc_now()),
                Reminder.due_at < end,
            )
            .order_by(Reminder.due_at, Message.id)
            .limit(2001)
        )
        .mappings()
        .all()
    )
    if len(sessions) > 5000 or len(reminders) > 2000 or len(occurrences) > 5000:
        raise ContentTooLargeError("Choose a smaller date range to show all records")
    return ScheduleBoard(
        plans=occurrences,
        sessions=[SessionResponse.model_validate(item) for item in sessions],
        reminders=[ReminderFlag(**dict(item)) for item in reminders],
    )
