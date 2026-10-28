"""Background delivery loop: sleeps until the next due item, or until data changes."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Select, event, func, select, union_all
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import utc_now
from app.notifications.models import NotificationDelivery
from app.notifications.worker import dispatch_dismissals, dispatch_due
from app.publishing.delivery import dispatch_writing
from app.publishing.models import ScheduledMessage, WritingDelivery, WritingPrompt
from app.publishing.worker import advance_due
from app.reminders.models import Reminder
from app.schedule.prompts.delivery import dispatch_plan_prompts
from app.schedule.prompts.models import PlanPrompt, PlanPromptDelivery

logger = logging.getLogger(__name__)

MAX_SLEEP = timedelta(seconds=60)
MIN_SLEEP = timedelta(seconds=1)
WATCHED_TABLES = {
    "reminders",
    "plan_prompts",
    "schedule_plans",
    "schedule_exceptions",
    "scheduled_messages",
    "writing_prompts",
}

_running: set[tuple[asyncio.AbstractEventLoop, asyncio.Event]] = set()


def wake() -> None:
    """Run the workers now instead of waiting for their next scheduled time."""
    for loop, changed in list(_running):
        loop.call_soon_threadsafe(changed.set)


@event.listens_for(Session, "after_flush")
def _note_changes(session: Session, _context: Any) -> None:
    touched = [
        *session.new,
        *session.deleted,
        *(o for o in session.dirty if session.is_modified(o)),
    ]
    if any(getattr(item, "__tablename__", None) in WATCHED_TABLES for item in touched):
        session.info["wake_worker"] = True


@event.listens_for(Session, "after_commit")
def _wake_after_commit(session: Session) -> None:
    if session.info.pop("wake_worker", False):
        wake()


@event.listens_for(Session, "after_soft_rollback")
def _forget_changes(session: Session, _transaction: Any) -> None:
    session.info.pop("wake_worker", None)


def next_due(engine: Engine, now: datetime) -> datetime | None:
    """Earliest future time at which anything needs to be sent or retried."""
    candidates: list[Select[Any]] = [
        select(Reminder.due_at.label("at")).where(Reminder.status == "active"),
        select(PlanPrompt.notify_at).where(PlanPrompt.status == "pending"),
        select(WritingPrompt.next_at).where(WritingPrompt.enabled.is_(True)),
        select(ScheduledMessage.send_at).where(ScheduledMessage.status == "pending"),
        *(
            select(model.retry_at).where(model.delivered_at.is_(None))
            for model in (NotificationDelivery, PlanPromptDelivery, WritingDelivery)
        ),
    ]
    times = union_all(*candidates).subquery()
    with Session(engine) as db:
        due: datetime | None = db.scalar(select(func.min(times.c.at)).where(times.c.at > now))
        return due


def run_cycle(
    engine: Engine, settings: Settings, now: datetime, started: datetime, previous: datetime | None
) -> bool:
    """Send everything that is due. Returns False while the server is in maintenance."""
    origin = settings.app_origin
    dispatch_due(engine, origin, settings)
    dispatch_dismissals(engine, origin, settings)
    dispatch_plan_prompts(engine, origin, settings)
    if settings.maintenance_path and settings.maintenance_path.exists():
        return False
    advance_due(engine, now, previous, max_gap=MAX_SLEEP + timedelta(seconds=30))
    dispatch_writing(engine, settings, started)
    return True


async def background_worker(engine: Engine, settings: Settings) -> None:
    changed = asyncio.Event()
    registration = (asyncio.get_running_loop(), changed)
    _running.add(registration)
    try:
        await _run(engine, settings, changed)
    finally:
        _running.discard(registration)


async def _run(engine: Engine, settings: Settings, changed: asyncio.Event) -> None:
    started = utc_now()
    previous: datetime | None = None
    while True:
        now = utc_now()
        try:
            active = await asyncio.to_thread(run_cycle, engine, settings, now, started, previous)
            previous = now if active else None
        except Exception:
            logger.exception("Background delivery cycle failed")
        # Changes made by this cycle are already handled; anything committed later wakes us.
        changed.clear()
        try:
            due = await asyncio.to_thread(next_due, engine, utc_now())
        except Exception:
            logger.exception("Could not read the next due time")
            due = None
        sleep = MAX_SLEEP if due is None else min(MAX_SLEEP, max(MIN_SLEEP, due - utc_now()))
        try:
            await asyncio.wait_for(changed.wait(), sleep.total_seconds())
        except TimeoutError:
            pass
