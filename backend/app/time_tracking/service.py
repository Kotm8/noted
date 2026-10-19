from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.time_tracking.models import Activity, TimeSession
from app.time_tracking.repository import TrackingRepository
from app.time_tracking.schemas import (
    ActivityCreate,
    ActivityOrder,
    ActivityUpdate,
    SessionResponse,
    SessionUpdate,
    TrackerAction,
    TrackerResponse,
    TrackingPreferences,
    TrackingPreferencesUpdate,
)


class TrackingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = TrackingRepository(db)

    def read(self, owner_id: UUID) -> TrackerResponse:
        state = self.repository.lock(owner_id)
        active = self.repository.active(owner_id)
        now = utc_now()
        result = TrackerResponse(
            revision=state.revision,
            active=SessionResponse.model_validate(active) if active else None,
            paused_activity_id=state.paused_activity_id,
            elapsed_seconds=state.elapsed_seconds
            + (max(0, int((now - active.started_at).total_seconds())) if active else 0),
            server_time=now,
            preferences=TrackingPreferences.model_validate(
                {key: getattr(state, key) for key in ("start_minute", "end_minute", "timezone")}
            ),
        )
        self.db.commit()
        return result

    def act(self, owner_id: UUID, data: TrackerAction) -> TrackerResponse:
        state = self.repository.lock(owner_id)
        if state.last_request_id == data.request_id:
            return self.read(owner_id)
        if state.revision != data.revision:
            raise ConflictError("The tracker changed on another device. Try again.")
        active = self.repository.active(owner_id)
        now = utc_now()
        if data.action == "start":
            if (
                data.activity_id is None
                or self.repository.activity(owner_id, data.activity_id).archived
            ):
                raise ValidationError("Choose an active activity")
            if active and active.activity_id == data.activity_id:
                state.last_request_id = data.request_id
                return self.read(owner_id)
        if data.action in {"start", "stop", "pause"} and active:
            active.ended_at = max(now, active.started_at + timedelta(microseconds=1))
            active.revision += 1
            state.elapsed_seconds += max(
                0, int((active.ended_at - active.started_at).total_seconds())
            )
            state.paused_activity_id = active.activity_id
            self.db.flush()
        if data.action == "start":
            self.db.add(
                TimeSession(owner_id=owner_id, activity_id=data.activity_id, started_at=now)
            )
            state.elapsed_seconds = 0
            state.paused_activity_id = None
        elif data.action == "resume" and not active:
            if (
                state.paused_activity_id is None
                or self.repository.activity(owner_id, state.paused_activity_id).archived
            ):
                raise ValidationError("There is no paused activity to resume")
            self.db.add(
                TimeSession(owner_id=owner_id, activity_id=state.paused_activity_id, started_at=now)
            )
            state.paused_activity_id = None
        elif data.action == "stop":
            state.elapsed_seconds = 0
            state.paused_activity_id = None
        state.revision += 1
        state.last_request_id = data.request_id
        self.db.flush()
        return self.read(owner_id)

    def preferences(self, owner_id: UUID, data: TrackingPreferencesUpdate) -> TrackerResponse:
        state = self.repository.lock(owner_id)
        if state.revision != data.revision:
            raise ConflictError("These settings changed on another device. Reload and try again.")
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(state, key, value)
        state.revision += 1
        return self.read(owner_id)

    def save_activity(
        self, owner_id: UUID, data: ActivityCreate | ActivityUpdate, activity_id: UUID | None = None
    ) -> Activity:
        state = self.repository.lock(owner_id)
        existing = self.db.scalar(
            select(Activity.id).where(
                Activity.owner_id == owner_id,
                func.lower(Activity.name) == data.name.lower(),
                Activity.id != activity_id,
            )
        )
        if existing:
            raise ConflictError("An activity with that name already exists")
        if activity_id:
            item = self.repository.activity(owner_id, activity_id)
            if not isinstance(data, ActivityUpdate) or item.revision != data.revision:
                raise ConflictError("This activity changed. Reload before editing.")
            if data.archived and not item.archived:
                active = self.repository.active(owner_id)
                if (
                    active and active.activity_id == activity_id
                ) or state.paused_activity_id == activity_id:
                    if active:
                        active.ended_at = max(
                            utc_now(), active.started_at + timedelta(microseconds=1)
                        )
                        active.revision += 1
                    state.paused_activity_id = None
                    state.elapsed_seconds = 0
                    state.revision += 1
                    state.last_request_id = None
            item.revision += 1
        else:
            items = self.repository.activities(owner_id)
            if len(items) >= 100:
                raise ValidationError("Keep up to 100 activities")
            item = Activity(
                owner_id=owner_id, position=max((entry.position for entry in items), default=-1) + 1
            )
            self.db.add(item)
        for key, value in data.model_dump(exclude={"revision"}).items():
            setattr(item, key, value)
        self.db.commit()
        self.db.refresh(item)
        return item

    def reorder(self, owner_id: UUID, data: ActivityOrder) -> list[Activity]:
        self.repository.lock(owner_id)
        items = self.repository.activities(owner_id)
        if len(set(data.ids)) != len(items) or set(data.ids) != {item.id for item in items}:
            raise ConflictError("The activity list changed. Reload before reordering.")
        positions = {identifier: index for index, identifier in enumerate(data.ids)}
        for item in items:
            item.position = positions[item.id]
            item.revision += 1
        self.db.commit()
        return self.repository.activities(owner_id)

    def edit_session(
        self, owner_id: UUID, identifier: UUID, revision: int, data: SessionUpdate | None = None
    ) -> TimeSession | None:
        self.repository.lock(owner_id)
        item = self.db.scalar(
            select(TimeSession).where(
                TimeSession.id == identifier, TimeSession.owner_id == owner_id
            )
        )
        if item is None:
            raise NotFoundError("Session not found")
        if item.ended_at is None:
            raise ValidationError("Stop the timer before changing its session")
        if item.revision != revision:
            raise ConflictError("This session changed. Reload before editing.")
        if data:
            self.repository.activity(owner_id, data.activity_id)
            if data.ended_at <= data.started_at or data.ended_at > utc_now():
                raise ValidationError("Choose a positive duration that ends in the past")
            overlap = self.db.scalar(
                select(TimeSession.id)
                .where(
                    TimeSession.owner_id == owner_id,
                    TimeSession.id != identifier,
                    TimeSession.started_at < data.ended_at,
                    or_(TimeSession.ended_at.is_(None), TimeSession.ended_at > data.started_at),
                )
                .limit(1)
            )
            if overlap:
                raise ConflictError("This time overlaps another recorded session")
            item.activity_id, item.started_at, item.ended_at = (
                data.activity_id,
                data.started_at,
                data.ended_at,
            )
            item.revision += 1
        else:
            self.db.delete(item)
        self.db.commit()
        return item if data else None
