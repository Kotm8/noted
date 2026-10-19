from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.notes.documents.models import ChannelDocument
from app.workspaces.models import Channel


class DocumentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, channel_id: UUID, lock: bool = False) -> ChannelDocument | None:
        if lock:
            self.db.scalar(
                select(Channel)
                .where(Channel.id == channel_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        return self.db.get(ChannelDocument, channel_id, populate_existing=lock)
