from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationError
from app.schedule.models import ScheduleException
from app.schedule.recurrence import occurs_on
from app.schedule.repository import ScheduleRepository
from app.schedule.schemas import PlanCreate
from app.workspaces.models import Channel, Workspace
from app.writing_nudges.schemas import WritingNudgeSettings


def target_channel(db: Session, owner_id: UUID, channel_id: UUID | None) -> Channel | None:
    return db.scalar(
        select(Channel)
        .join(Workspace, Workspace.id == Channel.workspace_id)
        .where(Channel.id == channel_id, Workspace.owner_id == owner_id)
    )


def validate_target(db: Session, owner_id: UUID, settings: WritingNudgeSettings | None) -> None:
    if settings and settings.enabled and target_channel(db, owner_id, settings.channel_id) is None:
        raise ValidationError("Choose one of your channels for writing nudges")


def plan_settings(
    db: Session,
    owner_id: UUID,
    activity_id: UUID,
    default: dict[str, Any] | None,
    plan_id: UUID | None,
    occurrence_date: date | None,
) -> dict[str, Any] | None:
    if plan_id is None:
        return default
    plan = ScheduleRepository(db).plan(owner_id, plan_id)
    day = occurrence_date or plan.date
    if not occurs_on(PlanCreate.model_validate(plan, from_attributes=True), day):
        raise ValidationError("Choose a valid planned occurrence")
    occurrence = db.get(ScheduleException, (plan.id, day)) or plan
    if getattr(occurrence, "deleted", False) or occurrence.activity_id != activity_id:
        raise ValidationError("This plan uses a different activity or was removed")
    return occurrence.writing_nudge if occurrence.writing_nudge is not None else default
