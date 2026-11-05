from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.ai.calendar.schemas import CalendarBlock, CalendarProposal, CalendarScope
from app.core.errors import ValidationError
from app.core.security import utc_now
from app.schedule.recurrence import instants
from app.schedule.schemas import PlanCreate


def plan_fields(block: CalendarBlock, scope: CalendarScope) -> PlanCreate:
    return PlanCreate(**block.model_dump(), timezone=scope.timezone)


def validate_blocks(
    blocks: list[CalendarBlock], scope: CalendarScope, activities: list[UUID]
) -> None:
    now = utc_now()
    for block in blocks:
        if block.activity_id not in activities:
            raise ValidationError("Choose an existing active activity for each suggestion.")
        if not scope.start <= block.date <= scope.end:
            raise ValidationError("Keep suggestions inside the selected dates.")
        if block.start_minute < scope.start_minute or block.end_minute > scope.end_minute:
            raise ValidationError("Keep suggestions inside the planning hours.")
        times = instants(plan_fields(block, scope), block.date)
        if times is None:
            raise ValidationError("A suggested time does not exist in the selected timezone.")
        if times[0] < now:
            raise ValidationError("A suggested start time has passed. Choose a future time.")


def validate_output(
    proposal: CalendarProposal, scope: CalendarScope, activities: list[UUID]
) -> dict[str, Any]:
    validate_blocks(proposal.blocks, scope, activities)
    return proposal.model_dump(mode="json")


def overlaps(first: tuple[datetime, datetime], second: tuple[datetime, datetime]) -> bool:
    return first[0].astimezone(UTC) < second[1].astimezone(UTC) and second[0].astimezone(
        UTC
    ) < first[1].astimezone(UTC)
