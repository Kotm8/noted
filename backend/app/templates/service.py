from datetime import datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.schedule.board import schedule_board
from app.schedule.schemas import PlanCreate, PlanResponse
from app.schedule.service import ScheduleService
from app.templates.models import DayTemplate, NoteTemplate, TemplateApplication
from app.templates.repository import TemplateRepository
from app.templates.schemas import (
    AppliedDay,
    ApplyDay,
    CaptureDay,
    DayBlock,
    DayTemplateFields,
    NoteTemplateFields,
)
from app.time_tracking.repository import TrackingRepository
from app.writing_nudges.configuration import validate_target


class TemplateService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = TemplateRepository(db)
        self.tracking = TrackingRepository(db)

    def check_revision(self, item: DayTemplate | NoteTemplate, revision: int) -> None:
        if item.revision != revision:
            raise ConflictError("This template changed on another device. Reload before editing.")

    def save_note(
        self,
        owner_id: UUID,
        data: NoteTemplateFields,
        identifier: UUID | None = None,
        revision: int | None = None,
    ) -> NoteTemplate:
        self.tracking.lock(owner_id)
        if identifier:
            item = self.repository.get(NoteTemplate, owner_id, identifier)
            self.check_revision(item, revision or 0)
            item.revision += 1
        else:
            self.check_limit(NoteTemplate, owner_id)
            item = NoteTemplate(owner_id=owner_id)
            self.db.add(item)
        item.name, item.content = data.name, data.content
        self.db.commit()
        self.db.refresh(item)
        return item

    def save_day(
        self,
        owner_id: UUID,
        data: DayTemplateFields,
        identifier: UUID | None = None,
        revision: int | None = None,
    ) -> DayTemplate:
        self.tracking.lock(owner_id)
        if identifier:
            item = self.repository.get(DayTemplate, owner_id, identifier)
            self.check_revision(item, revision or 0)
            item.revision += 1
        else:
            self.check_limit(DayTemplate, owner_id)
            item = DayTemplate(owner_id=owner_id)
        for block in data.blocks:
            self.tracking.activity(owner_id, block.activity_id)
            validate_target(self.db, owner_id, block.writing_nudge)
        item.name = data.name
        item.blocks = [block.model_dump(mode="json") for block in data.blocks]
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return item

    def check_limit(self, model: type[DayTemplate] | type[NoteTemplate], owner_id: UUID) -> None:
        if len(self.repository.list(model, owner_id)) >= 100:
            raise ValidationError("Keep up to 100 templates of each kind")

    def remove(
        self,
        model: type[DayTemplate] | type[NoteTemplate],
        owner_id: UUID,
        identifier: UUID,
        revision: int,
    ) -> None:
        self.tracking.lock(owner_id)
        item = self.repository.get(model, owner_id, identifier)
        self.check_revision(item, revision)
        self.db.delete(item)
        self.db.commit()

    def capture(self, owner_id: UUID, data: CaptureDay) -> DayTemplate:
        zone = ZoneInfo(data.timezone)
        start = datetime.combine(data.date, time(), zone)
        end = datetime.combine(data.date + timedelta(days=1), time(), zone)
        board = schedule_board(self.db, owner_id, start, end)
        blocks = []
        for plan in board.plans:
            first, last = plan.start_at.astimezone(zone), plan.end_at.astimezone(zone)
            blocks.append(
                DayBlock(
                    **plan.model_dump(
                        include={
                            "activity_id",
                            "title",
                            "notifications_enabled",
                            "notification_minutes",
                            "writing_nudge",
                        }
                    ),
                    start_minute=0 if first.date() < data.date else first.hour * 60 + first.minute,
                    end_minute=1440 if last.date() > data.date else last.hour * 60 + last.minute,
                )
            )
        if len(blocks) > 200:
            raise ValidationError("A template can contain up to 200 blocks")
        return self.save_day(owner_id, DayTemplateFields(name=data.name, blocks=blocks))

    def apply(self, owner_id: UUID, identifier: UUID, data: ApplyDay) -> AppliedDay:
        self.tracking.lock(owner_id)
        previous = self.db.get(TemplateApplication, data.request_id)
        if previous is not None:
            if (
                previous.owner_id,
                previous.template_id,
                previous.template_revision,
                previous.date,
                previous.timezone,
            ) != (owner_id, identifier, data.revision, data.date, data.timezone):
                raise ConflictError(
                    "This request was already used for a different template application"
                )
            return AppliedDay.model_validate({"plans": previous.plans})
        template = self.repository.get(DayTemplate, owner_id, identifier)
        self.check_revision(template, data.revision)
        if not template.blocks:
            raise ValidationError("Add at least one block before using this template")
        schedule = ScheduleService(self.db)
        plans = []
        for raw in template.blocks:
            block = DayBlock.model_validate(raw)
            activity = self.tracking.activity(owner_id, block.activity_id)
            if activity.archived:
                raise ValidationError(f"Restore or replace the archived activity: {activity.name}")
            plan = schedule.add(
                owner_id,
                PlanCreate(
                    **(block.model_dump() | {"title": block.title.strip() or activity.name}),
                    date=data.date,
                    timezone=data.timezone,
                ),
            )
            self.db.flush()
            plans.append(PlanResponse.model_validate(plan))
        self.db.add(
            TemplateApplication(
                request_id=data.request_id,
                owner_id=owner_id,
                template_id=identifier,
                template_revision=data.revision,
                date=data.date,
                timezone=data.timezone,
                plans=[plan.model_dump(mode="json") for plan in plans],
            )
        )
        self.db.commit()
        return AppliedDay(plans=plans)
