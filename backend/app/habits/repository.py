from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.habits.models import Habit


class HabitRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def all(self, owner_id: UUID) -> list[Habit]:
        return list(
            self.db.scalars(
                select(Habit)
                .where(Habit.owner_id == owner_id, Habit.archived.is_(False))
                .order_by(Habit.starts_on, Habit.id)
            )
        )

    def get(self, owner_id: UUID, habit_id: UUID) -> Habit:
        habit = self.db.scalar(
            select(Habit)
            .where(Habit.id == habit_id, Habit.owner_id == owner_id, Habit.archived.is_(False))
            .with_for_update()
        )
        if habit is None:
            raise NotFoundError("Habit not found")
        return habit
