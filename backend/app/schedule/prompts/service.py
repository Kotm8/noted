from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.errors import ConflictError, NotFoundError
from app.core.security import utc_now
from app.notifications.schemas import NotificationSettings
from app.schedule.models import ScheduleException, SchedulePlan
from app.schedule.prompts.models import PlanPrompt, PlanPromptEvent
from app.schedule.prompts.schemas import PromptAction
from app.schedule.recurrence import instants, occurs_on
from app.schedule.repository import ScheduleRepository
from app.schedule.schemas import PlanCreate, PlanFields
from app.time_tracking.repository import TrackingRepository
from app.time_tracking.schemas import TrackerAction
from app.time_tracking.service import TrackingService


def resolve(
    plan: SchedulePlan, day: date, override: ScheduleException | None
) -> tuple[PlanFields, datetime] | None:
    if (
        plan.deleted_at
        or (override and override.deleted)
        or not occurs_on(PlanCreate.model_validate(plan, from_attributes=True), day)
    ):
        return None
    fields = (
        PlanFields.model_validate(override, from_attributes=True)
        if override
        else PlanFields.model_validate(
            PlanFields.model_validate(plan, from_attributes=True).model_dump() | {"date": day}
        )
    )
    times = instants(fields, fields.date)
    return (fields, times[0]) if times and fields.notifications_enabled else None


def refresh_prompts(db: Session, owner_id: UUID, now: datetime | None = None) -> None:
    now = now or utc_now()
    tracking = TrackingRepository(db)
    tracking.lock(owner_id)
    user = db.get(User, owner_id)
    if user is None:
        return
    preferences = NotificationSettings.model_validate(user.notification_preferences or {})
    repository = ScheduleRepository(db)
    plans = repository.plans(owner_id)
    activities = {item.id: item for item in tracking.activities(owner_id)}
    exceptions = repository.exceptions([item.id for item in plans])
    overrides = {(item.plan_id, item.occurrence_date): item for item in exceptions}
    rows = list(
        db.scalars(
            select(PlanPrompt).where(
                PlanPrompt.owner_id == owner_id,
                or_(
                    PlanPrompt.status == "pending",
                    PlanPrompt.planned_start >= now - timedelta(days=2),
                ),
            )
        )
    )
    existing = {(item.plan_id, item.occurrence_date): item for item in rows}
    valid: set[UUID] = set()
    for plan in plans:
        today = now.astimezone(ZoneInfo(plan.timezone)).date()
        dates = {today + timedelta(days=offset) for offset in (-1, 0, 1)}
        dates.update(
            item.occurrence_date
            for item in exceptions
            if item.plan_id == plan.id and abs((item.date - today).days) <= 1
        )
        dates.update(
            item.occurrence_date
            for item in rows
            if item.plan_id == plan.id and item.status == "pending"
        )
        latest: PlanPrompt | None = None
        for day in sorted(dates):
            item = existing.get((plan.id, day))
            occurrence = resolve(plan, day, overrides.get((plan.id, day)))
            if occurrence is None:
                continue
            fields, start = occurrence
            activity = activities.get(fields.activity_id)
            if activity is None or activity.archived:
                continue
            lead = (
                fields.notification_minutes
                if fields.notification_minutes is not None
                else preferences.plan_notice_minutes
            )
            notice = start - timedelta(minutes=lead)
            if item is None:
                if notice > now or start < now - timedelta(days=1):
                    continue
                item = PlanPrompt(
                    plan_id=plan.id,
                    owner_id=owner_id,
                    occurrence_date=day,
                    activity_id=fields.activity_id,
                    title=fields.title,
                    planned_start=start,
                    scheduled_notice_at=notice,
                    notify_at=notice,
                    status="pending",
                    revision=1,
                    delayed=False,
                )
                db.add(item)
                db.flush()
                rows.append(item)
            elif item.status in {"pending", "cancelled"} and (
                item.planned_start != start
                or item.title != fields.title
                or item.activity_id != fields.activity_id
                or item.scheduled_notice_at != notice
                or item.status == "cancelled"
            ):
                changed_plan = item.planned_start != start or item.activity_id != fields.activity_id
                item.planned_start, item.activity_id, item.title = (
                    start,
                    fields.activity_id,
                    fields.title,
                )
                item.scheduled_notice_at = notice
                if changed_plan or not item.delayed:
                    item.notify_at, item.delayed = notice, False
                item.status = "pending"
                item.revision += 1
            valid.add(item.id)
            if (
                item.status == "pending"
                and notice <= now
                and (latest is None or item.planned_start > latest.planned_start)
            ):
                latest = item
        if latest:
            for item in rows:
                if (
                    item.plan_id == plan.id
                    and item.status == "pending"
                    and item.planned_start < latest.planned_start
                ):
                    item.status = "superseded"
                    item.revision += 1
    for item in rows:
        if item.status == "pending" and item.id not in valid:
            item.status = "cancelled"
            item.revision += 1
    db.flush()


def due_prompts(db: Session, owner_id: UUID) -> list[PlanPrompt]:
    refresh_prompts(db, owner_id)
    result = list(
        db.scalars(
            select(PlanPrompt)
            .where(
                PlanPrompt.owner_id == owner_id,
                PlanPrompt.status == "pending",
                PlanPrompt.notify_at <= utc_now(),
            )
            .order_by(PlanPrompt.notify_at, PlanPrompt.id)
            .limit(20)
        )
    )
    db.commit()
    return result


def act_on_prompt(db: Session, owner_id: UUID, prompt_id: UUID, data: PromptAction) -> PlanPrompt:
    tracking = TrackingRepository(db)
    state = tracking.lock(owner_id)
    item = db.scalar(
        select(PlanPrompt)
        .where(PlanPrompt.owner_id == owner_id, PlanPrompt.id == prompt_id)
        .with_for_update()
    )
    if item is None:
        raise NotFoundError("Task prompt not found")
    if item.last_request_id == data.request_id:
        db.commit()
        return item
    refresh_prompts(db, owner_id)
    if item.status != "pending" or item.revision != data.revision:
        raise ConflictError(
            "This task prompt changed on another device. Refresh it before trying again."
        )
    activity_id = item.activity_id if data.action == "start" else data.activity_id
    if activity_id is not None and tracking.activity(owner_id, activity_id).archived:
        raise ConflictError("This activity was archived. Choose another activity.")
    if data.action == "start":
        item.status = "started"
    else:
        now = utc_now()
        requested = min(data.requested_at, now) if data.requested_at else now
        if requested < now - timedelta(days=1):
            raise ConflictError("This delayed action is too old. Open the task prompt again.")
        item.notify_at = requested + timedelta(minutes=data.minutes or 5)
        item.delayed = True
    item.last_request_id = data.request_id
    item.revision += 1
    db.add(
        PlanPromptEvent(
            plan_id=item.plan_id,
            occurrence_date=item.occurrence_date,
            action=data.action,
            minutes=data.minutes if data.action != "start" else None,
            reason=data.reason,
            activity_id=activity_id,
        )
    )
    if data.action in {"start", "other"}:
        TrackingService(db).act(
            owner_id,
            TrackerAction(
                action="start",
                activity_id=activity_id,
                revision=state.revision,
                request_id=data.request_id,
            ),
        )
    else:
        db.commit()
    db.refresh(item)
    return item


def prompt_history(db: Session, owner_id: UUID, plan_id: UUID) -> list[PlanPromptEvent]:
    ScheduleRepository(db).plan(owner_id, plan_id)
    return list(
        db.scalars(
            select(PlanPromptEvent)
            .where(PlanPromptEvent.plan_id == plan_id)
            .order_by(PlanPromptEvent.created_at.desc())
            .limit(50)
        )
    )
