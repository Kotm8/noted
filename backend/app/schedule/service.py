from datetime import date
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.core.security import utc_now
from app.schedule.models import ScheduleException, SchedulePlan
from app.schedule.recurrence import instants, occurs_on
from app.schedule.repository import ScheduleRepository
from app.schedule.schemas import PlanCreate, PlanFields, PlanUpdate
from app.time_tracking.repository import TrackingRepository


class ScheduleService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = ScheduleRepository(db)
        self.tracking = TrackingRepository(db)

    def create(self, owner_id: UUID, data: PlanCreate) -> SchedulePlan:
        self.tracking.lock(owner_id)
        self.tracking.activity(owner_id, data.activity_id)
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
        if instants(data, data.date) is None:
            raise ValidationError("This time does not exist in the selected timezone")
        item = SchedulePlan(owner_id=owner_id, **data.model_dump())
        self.db.add(item)
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
            exception = ScheduleException(
                plan_id=item.id,
                occurrence_date=day,
                **PlanFields.model_validate(item, from_attributes=True).model_dump(
                    exclude={"date"}
                ),
                date=day,
            )
            self.db.add(exception)
        return exception

    def update(self, owner_id: UUID, plan_id: UUID, data: PlanUpdate) -> SchedulePlan:
        item = self.checked(owner_id, plan_id, data.revision)
        self.tracking.activity(owner_id, data.activity_id)
        if instants(data, data.date) is None:
            raise ValidationError("This time does not exist in the selected timezone")
        if data.scope == "occurrence":
            if data.occurrence_date is None:
                raise ValidationError("Choose the occurrence date")
            target = self.exception(item, data.occurrence_date)
            for key in PlanFields.model_fields:
                setattr(target, key, getattr(data, key))
            target.deleted = False
        else:
            for key in PlanCreate.model_fields:
                setattr(item, key, getattr(data, key))
            self.db.execute(delete(ScheduleException).where(ScheduleException.plan_id == item.id))
        item.revision += 1
        self.db.commit()
        self.db.refresh(item)
        return item

    def remove(
        self, owner_id: UUID, plan_id: UUID, revision: int, day: date | None, reset: bool = False
    ) -> SchedulePlan:
        item = self.checked(owner_id, plan_id, revision)
        if day:
            if reset:
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
