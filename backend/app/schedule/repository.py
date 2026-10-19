from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.schedule.models import ScheduleException, SchedulePlan


class ScheduleRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def plan(self, owner_id: UUID, plan_id: UUID, include_deleted: bool = False) -> SchedulePlan:
        query = select(SchedulePlan).where(
            SchedulePlan.owner_id == owner_id, SchedulePlan.id == plan_id
        )
        if not include_deleted:
            query = query.where(SchedulePlan.deleted_at.is_(None))
        item = self.db.scalar(query)
        if item is None:
            raise NotFoundError("Plan not found")
        return item

    def plans(self, owner_id: UUID) -> list[SchedulePlan]:
        return list(
            self.db.scalars(
                select(SchedulePlan)
                .where(SchedulePlan.owner_id == owner_id, SchedulePlan.deleted_at.is_(None))
                .order_by(SchedulePlan.date, SchedulePlan.id)
                .limit(1001)
            )
        )

    def exceptions(self, ids: list[UUID]) -> list[ScheduleException]:
        return (
            list(
                self.db.scalars(select(ScheduleException).where(ScheduleException.plan_id.in_(ids)))
            )
            if ids
            else []
        )
