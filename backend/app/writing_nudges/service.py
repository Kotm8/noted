from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.live import mark
from app.writing_nudges.configuration import target_channel
from app.writing_nudges.models import WritingNudge, WritingNudgeRun
from app.writing_nudges.schemas import WritingNudgeSettings


class NudgeService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run(self, owner_id: UUID) -> WritingNudgeRun | None:
        return self.db.scalar(
            select(WritingNudgeRun).where(WritingNudgeRun.owner_id == owner_id).with_for_update()
        )

    def start(
        self, owner_id: UUID, activity_id: UUID, settings: dict[str, Any] | None, now: datetime
    ) -> None:
        config = WritingNudgeSettings.model_validate(settings or {})
        if not config.enabled or target_channel(self.db, owner_id, config.channel_id) is None:
            return
        seconds = config.interval_minutes * 60
        self.db.add(
            WritingNudgeRun(
                id=uuid4(),
                owner_id=owner_id,
                activity_id=activity_id,
                channel_id=config.channel_id,
                settings=config.model_dump(mode="json"),
                remaining_seconds=seconds,
                tracked_seconds=0,
                resumed_at=now,
                next_at=now + timedelta(seconds=seconds),
            )
        )

    def consume(self, run: WritingNudgeRun, now: datetime) -> None:
        if run.resumed_at is not None:
            elapsed = max(0, (now - run.resumed_at).total_seconds())
            run.remaining_seconds = max(0, run.remaining_seconds - elapsed)
            run.tracked_seconds += elapsed
            run.resumed_at = now

    def notify(self, run: WritingNudgeRun, now: datetime) -> None:
        mark(self.db, "publishing", user=run.owner_id, channel=run.channel_id)
        run.tracked_seconds = 0
        for previous in self.pending(channel_id=run.channel_id, lock=True):
            if previous.id != run.id:
                previous.completed_at = now
                previous.revision += 1
        item = self.db.get(WritingNudge, run.id, with_for_update=True)
        if item is None:
            item = WritingNudge(
                id=run.id,
                owner_id=run.owner_id,
                channel_id=run.channel_id,
                content=run.settings["content"],
                due_at=now,
            )
            self.db.add(item)
        else:
            item.due_at = now
            item.completed_at = None
            item.revision += 1

    def pause(self, owner_id: UUID, now: datetime) -> None:
        if run := self.run(owner_id):
            self.consume(run, now)
            if run.remaining_seconds <= 0:
                self.notify(run, now)
                run.remaining_seconds = run.settings["interval_minutes"] * 60
            run.resumed_at = None
            run.next_at = None

    def resume(self, owner_id: UUID, now: datetime) -> None:
        if run := self.run(owner_id):
            run.resumed_at = now
            run.next_at = now + timedelta(seconds=run.remaining_seconds)

    def finish(self, owner_id: UUID, now: datetime, notify: bool = True) -> None:
        if run := self.run(owner_id):
            self.consume(run, now)
            if notify and (
                run.remaining_seconds <= 0 or (run.settings["on_stop"] and run.tracked_seconds > 0)
            ):
                self.notify(run, now)
            self.db.delete(run)
            self.db.flush()

    def wrote(self, channel_id: UUID, now: datetime) -> None:
        runs = self.db.scalars(
            select(WritingNudgeRun)
            .where(WritingNudgeRun.channel_id == channel_id)
            .with_for_update()
        ).all()
        for run in runs:
            run.remaining_seconds = run.settings["interval_minutes"] * 60
            run.tracked_seconds = 0
            if run.resumed_at is not None:
                run.resumed_at = now
                run.next_at = now + timedelta(seconds=run.remaining_seconds)
        for item in self.pending(channel_id=channel_id, lock=True):
            item.completed_at = now
            item.revision += 1

    def pending(
        self, owner_id: UUID | None = None, channel_id: UUID | None = None, lock: bool = False
    ) -> list[WritingNudge]:
        query = select(WritingNudge).where(WritingNudge.completed_at.is_(None))
        if owner_id is not None:
            query = query.where(WritingNudge.owner_id == owner_id)
        if channel_id is not None:
            query = query.where(WritingNudge.channel_id == channel_id)
        query = query.order_by(WritingNudge.due_at.desc()).limit(100)
        return list(self.db.scalars(query.with_for_update() if lock else query))

    def dismiss(self, owner_id: UUID, identifier: UUID, revision: int, now: datetime) -> None:
        item = self.db.scalar(
            select(WritingNudge)
            .where(WritingNudge.id == identifier, WritingNudge.owner_id == owner_id)
            .with_for_update()
        )
        if item is None:
            raise NotFoundError("Writing nudge not found")
        if item.revision != revision:
            raise ConflictError("This writing nudge changed. Try again.")
        item.completed_at = now
        item.revision += 1
        self.db.commit()
