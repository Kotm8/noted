import asyncio
import json
import logging
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.core.config import Settings
from app.core.security import utc_now
from app.live.models import WatchSyncState
from app.notifications.delivery import send_push
from app.notifications.models import PushSubscription
from app.wear.models import WatchDevice

logger = logging.getLogger(__name__)
SYNC_TOPICS = {"tracker", "schedule", "prompts", "reminders", "settings"}
COOLDOWN = timedelta(seconds=30)


class WatchSync:
    def __init__(self, engine: Engine, settings: Settings) -> None:
        self.engine = engine
        self.settings = settings
        self.pending: set[UUID] = set()
        self.catch_up = False

    def record_all(self) -> None:
        with Session(self.engine) as db:
            users = set(
                db.scalars(
                    select(LoginSession.user_id).join(WatchDevice).where(LoginSession.live())
                )
            )
        self.record(users, utc_now())

    def record(self, users: set[UUID], now: datetime) -> None:
        if not users:
            return
        with Session(self.engine) as db:
            subscriptions = db.scalars(
                select(PushSubscription.id)
                .join(LoginSession)
                .join(WatchDevice, WatchDevice.session_id == LoginSession.id)
                .where(LoginSession.user_id.in_(users), LoginSession.live(now))
                .order_by(PushSubscription.id)
            )
            for subscription in subscriptions:
                statement = insert(WatchSyncState).values(
                    subscription_id=subscription, requested_at=now
                )
                db.execute(
                    statement.on_conflict_do_update(
                        index_elements=[WatchSyncState.subscription_id], set_={"requested_at": now}
                    )
                )
            db.commit()

    def deliver(self, now: datetime | None = None) -> None:
        at = now or utc_now()
        with Session(self.engine) as db:
            due = db.execute(
                select(WatchSyncState, PushSubscription)
                .join(PushSubscription)
                .join(LoginSession)
                .where(
                    WatchSyncState.requested_at.is_not(None),
                    LoginSession.live(at),
                    or_(
                        WatchSyncState.last_sent_at.is_(None),
                        WatchSyncState.last_sent_at <= at - COOLDOWN,
                    ),
                )
                .order_by(WatchSyncState.subscription_id)
                .with_for_update(of=WatchSyncState, skip_locked=True)
                .limit(20)
            ).all()
            for state, subscription in due:
                maintenance = self.settings.maintenance_path
                if maintenance and maintenance.exists():
                    return
                state.last_sent_at = now or utc_now()
                outcome = send_push(
                    subscription,
                    "",
                    self.settings.app_origin,
                    json.dumps({"kind": "sync"}),
                    ttl=60,
                    settings=self.settings,
                    collapse_key="noted-sync",
                )
                if outcome == "accepted":
                    state.requested_at = None
                elif outcome == "expired":
                    db.delete(subscription)
            db.commit()

    async def run(self) -> None:
        delay = 1
        reported = False
        while True:
            users = set(self.pending)
            self.pending.difference_update(users)
            try:
                if self.catch_up:
                    await asyncio.to_thread(self.record_all)
                    self.catch_up = False
                await asyncio.to_thread(self.record, users, utc_now())
                await asyncio.to_thread(self.deliver)
                delay = 1
                reported = False
            except Exception:
                self.pending.update(users)
                if not reported:
                    logger.exception("Watch live sync failed; retrying.")
                    reported = True
                delay = min(30, delay * 2)
            await asyncio.sleep(delay)
