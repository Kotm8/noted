from datetime import datetime, timedelta
from uuid import UUID

from app.schedule.prompts.models import PlanPrompt
from app.schedule.schemas import PlanFields
from app.time_tracking.models import TimeSession

Span = tuple[UUID, PlanFields, datetime, datetime]


def still_running(
    plan_id: UUID, fields: PlanFields, end: datetime, spans: list[Span]
) -> PlanFields | None:
    """The overlapping plan that carries on past this one's end, offered as a switch.

    Plans of the same activity don't count, since tracking continues unchanged. When several
    overlap, the one that started last is the most specific thing you planned for that time.
    """
    running = [
        (start, other)
        for other_id, other, start, other_end in spans
        if other_id != plan_id
        and other.activity_id != fields.activity_id
        and start < end < other_end
    ]
    return max(running, key=lambda item: item[0])[1] if running else None


def refresh_end_prompt(
    item: PlanPrompt,
    fields: PlanFields,
    start: datetime,
    end: datetime,
    active: TimeSession | None,
    spans: list[Span],
    now: datetime,
) -> None:
    target = still_running(item.plan_id, fields, end, spans)
    switch = (target.activity_id, target.title) if target else (None, None)
    if item.phase != "end":
        item.phase = "end"
        item.status = "pending"
        item.delayed = False
        item.notify_at = end
        item.tracked_session_id = active.id if active else None
        item.last_request_id = None
        item.switch_activity_id, item.switch_title = switch
        item.revision += 1
    elif item.status == "pending" and (
        item.planned_end != end or (item.switch_activity_id, item.switch_title) != switch
    ):
        if item.planned_end != end:
            item.notify_at = end
            item.delayed = False
        item.switch_activity_id, item.switch_title = switch
        item.revision += 1
    item.planned_end = end
    item.scheduled_notice_at = end
    item.planned_start = start
    item.title = fields.title
    item.activity_id = fields.activity_id
    if item.status != "pending":
        return
    window = max(end, now)
    # A plan starting right after this one sends its own start prompt instead, unless an
    # overlapping plan is still running, which the end prompt offers to switch to.
    next_soon = target is None and any(
        end <= instant <= end + timedelta(minutes=15)
        or window <= instant <= window + timedelta(minutes=15)
        for _plan, _fields, instant, _end in spans
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
