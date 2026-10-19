from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.errors import NotFoundError
from app.time_tracking.models import Activity, TimeSession, TrackerState


class TrackingRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def lock(self, owner_id: UUID) -> TrackerState:
        if self.db.scalar(select(User).where(User.id == owner_id).with_for_update()) is None:
            raise NotFoundError("Account not found")
        state = self.db.get(TrackerState, owner_id)
        if state is None:
            state = TrackerState(owner_id=owner_id)
            self.db.add(state)
            self.db.flush()
        return state

    def activity(self, owner_id: UUID, activity_id: UUID) -> Activity:
        item = self.db.scalar(
            select(Activity).where(Activity.owner_id == owner_id, Activity.id == activity_id)
        )
        if item is None:
            raise NotFoundError("Activity not found")
        return item

    def activities(self, owner_id: UUID) -> list[Activity]:
        return list(
            self.db.scalars(
                select(Activity)
                .where(Activity.owner_id == owner_id)
                .order_by(Activity.position, Activity.id)
            )
        )

    def active(self, owner_id: UUID) -> TimeSession | None:
        return self.db.scalar(
            select(TimeSession).where(
                TimeSession.owner_id == owner_id, TimeSession.ended_at.is_(None)
            )
        )

    def sessions(self, owner_id: UUID, start: datetime, end: datetime) -> list[TimeSession]:
        return list(
            self.db.scalars(
                select(TimeSession)
                .where(
                    TimeSession.owner_id == owner_id,
                    TimeSession.started_at < end,
                    or_(TimeSession.ended_at.is_(None), TimeSession.ended_at > start),
                )
                .order_by(TimeSession.started_at, TimeSession.id)
                .limit(5001)
            )
        )
