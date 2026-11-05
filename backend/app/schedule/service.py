from datetime import date
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.core.security import utc_now
from app.live import mark
from app.schedule.models import ScheduleException, SchedulePlan
from app.schedule.recurrence import instants, occurs_on
from app.schedule.repository import ScheduleRepository
from app.schedule.schemas import PlanCreate, PlanFields, PlanUpdate
from app.time_tracking.repository import TrackingRepository
from app.writing_nudges.configuration import validate_target


class ScheduleService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = ScheduleRepository(db)
        self.tracking = TrackingRepository(db)

    def create(
        self, owner_id: UUID, data: PlanCreate, client_id: UUID | None = None
    ) -> SchedulePlan:
        if client_id:
            self.tracking.lock(owner_id)
            previous = self.db.get(SchedulePlan, client_id)
            if previous is not None:
                if (
                    previous.owner_id != owner_id
                    or previous.deleted_at is not None
                    or PlanCreate.model_validate(previous, from_attributes=True) != data
                ):
                    raise ConflictError("This plan was already saved differently. Review it first.")
                return previous
        item = self.add(owner_id, data)
        if client_id:
            item.id = client_id
        self.db.commit()
        self.db.refresh(item)
        return item

    def add(self, owner_id: UUID, data: PlanCreate) -> SchedulePlan:
        self.tracking.lock(owner_id)
        self.tracking.activity(owner_id, data.activity_id)
        validate_target(self.db, owner_id, data.writing_nudge)
        self.check_capacity(owner_id)
        if instants(data, data.date) is None:
            raise ValidationError("This time does not exist in the selected timezone")
        values = data.model_dump()
        values["writing_nudge"] = (
            data.writing_nudge.model_dump(mode="json") if data.writing_nudge else None
        )
        item = SchedulePlan(owner_id=owner_id, **values)
        self.db.add(item)
        return item

    def check_capacity(self, owner_id: UUID) -> None:
        total = (
            self.db.scalar(
                select(func.count())
                .select_from(SchedulePlan)
                .where(SchedulePlan.owner_id == owner_id, SchedulePlan.deleted_at.is_(None))
            )
            or 0
        )
        if total >= 1000:
            raise ValidationError("Keep up to 1,000 schedule plans")

    def restore(self, owner_id: UUID, plan_id: UUID, revision: int) -> SchedulePlan:
        """Brings back a deleted plan for Undo, keeping its id, exceptions, and prompt history."""
        mark(self.db, "schedule", user=owner_id)
        item = self.checked(owner_id, plan_id, revision, include_deleted=True)
        if item.deleted_at is None:
            return item
        self.tracking.activity(owner_id, item.activity_id)
        self.check_capacity(owner_id)
        item.deleted_at = None
        item.revision += 1
        self.db.commit()
        self.db.refresh(item)
        return item

    def checked(
        self, owner_id: UUID, plan_id: UUID, revision: int, include_deleted: bool = False
    ) -> SchedulePlan:
        self.tracking.lock(owner_id)
        item = self.repository.plan(owner_id, plan_id, include_deleted)
        if item.revision != revision:
            raise ConflictError("This plan changed on another device. Reload before editing.")
        return item

    def exception(self, item: SchedulePlan, day: date) -> ScheduleException:
        if item.frequency == "none" or not occurs_on(
            PlanCreate.model_validate(item, from_attributes=True), day
        ):
            raise ValidationError("Choose a valid occurrence of this repeating plan")
        exception = self.db.get(ScheduleException, (item.id, day))
        if exception is None:
            values = PlanFields.model_validate(item, from_attributes=True).model_dump(
                exclude={"date", "writing_nudge"}
            )
            values["writing_nudge"] = item.writing_nudge
            exception = ScheduleException(
                plan_id=item.id,
                occurrence_date=day,
                **values,
                date=day,
            )
            self.db.add(exception)
        return exception

    def update(
        self, owner_id: UUID, plan_id: UUID, data: PlanUpdate, *, commit: bool = True
    ) -> SchedulePlan:
        mark(self.db, "schedule", user=owner_id)
        item = self.checked(owner_id, plan_id, data.revision)
        self.tracking.activity(owner_id, data.activity_id)
        validate_target(self.db, owner_id, data.writing_nudge)
        if instants(data, data.date) is None:
            raise ValidationError("This time does not exist in the selected timezone")
        if data.scope == "occurrence":
            if data.occurrence_date is None:
                raise ValidationError("Choose the occurrence date")
            target = self.exception(item, data.occurrence_date)
            for key in PlanFields.model_fields:
                value = getattr(data, key)
                setattr(
                    target,
                    key,
                    value.model_dump(mode="json") if key == "writing_nudge" and value else value,
                )
            target.deleted = False
        else:
            for key in PlanCreate.model_fields:
                value = getattr(data, key)
                setattr(
                    item,
                    key,
                    value.model_dump(mode="json") if key == "writing_nudge" and value else value,
                )
            self.db.execute(delete(ScheduleException).where(ScheduleException.plan_id == item.id))
        item.revision += 1
        if commit:
            self.db.commit()
            self.db.refresh(item)
        else:
            self.db.flush()
        return item

    def remove(
        self, owner_id: UUID, plan_id: UUID, revision: int, day: date | None, reset: bool = False
    ) -> SchedulePlan:
        item = self.checked(owner_id, plan_id, revision)
        if day:
            if reset:
                mark(self.db, "schedule", user=owner_id)
                self.exception(item, day)
                self.db.flush()
                self.db.execute(
                    delete(ScheduleException).where(
                        ScheduleException.plan_id == item.id,
                        ScheduleException.occurrence_date == day,
                    )
                )
            else:
                self.exception(item, day).deleted = True
        else:
            item.deleted_at = utc_now()
        item.revision += 1
        self.db.commit()
        self.db.refresh(item)
        return item
