from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.templates.models import DayTemplate, NoteTemplate


class TemplateRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list[T: DayTemplate | NoteTemplate](self, model: type[T], owner_id: UUID) -> list[T]:
        return list(
            self.db.scalars(
                select(model).where(model.owner_id == owner_id).order_by(model.name, model.id)
            )
        )

    def get[T: DayTemplate | NoteTemplate](
        self, model: type[T], owner_id: UUID, identifier: UUID
    ) -> T:
        item = self.db.scalar(
            select(model).where(model.owner_id == owner_id, model.id == identifier)
        )
        if item is None:
            raise NotFoundError("Template not found")
        return item
