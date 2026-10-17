from sqlalchemy import text
from sqlalchemy.orm import Session


class HealthRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_schema_revision(self) -> str | None:
        revision = self.db.scalar(text("SELECT version_num FROM alembic_version"))
        return str(revision) if revision is not None else None
