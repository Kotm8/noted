from datetime import datetime, timedelta

from app.schedule.prompts.models import PlanPrompt
from app.schedule.schemas import PlanFields
from app.time_tracking.models import TimeSession


def refresh_end_prompt(
    item: PlanPrompt,
    fields: PlanFields,
    start: datetime,
    end: datetime,
    active: TimeSession | None,
    starts: list[datetime],
    now: datetime,
) -> None:
    if item.phase != "end":
        item.phase = "end"
        item.status = "pending"
        item.delayed = False
        item.notify_at = end
        item.tracked_session_id = active.id if active else None
        item.last_request_id = None
        item.revision += 1
    elif item.planned_end != end and item.status == "pending":
        item.notify_at = end
        item.delayed = False
        item.revision += 1
    item.planned_end = end
    item.scheduled_notice_at = end
    item.planned_start = start
    item.title = fields.title
    item.activity_id = fields.activity_id
    if item.status != "pending":
        return
    window = max(end, now)
    next_soon = any(
        end <= instant <= end + timedelta(minutes=15)
        or window <= instant <= window + timedelta(minutes=15)
        for instant in starts
    )
    if (
        active is None
        or active.id != item.tracked_session_id
        or active.activity_id != fields.activity_id
        or active.started_at >= end
        or end < now - timedelta(days=1)
        or next_soon
    ):
        item.status = "superseded"
        item.revision += 1
