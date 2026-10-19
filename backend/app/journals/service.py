from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import utc_now
from app.journals.models import JournalEntry
from app.journals.repository import JournalRepository
from app.journals.schemas import JournalCreate, JournalUpdate
from app.publishing.repository import complete_writing
from app.workspaces.services.channels import ChannelService


class JournalService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = JournalRepository(db)
        self.channels = ChannelService(db)

    def channel(self, channel_id: UUID, owner_id: UUID) -> None:
        if self.channels.get_channel(channel_id, owner_id).kind != "journal":
            raise ValidationError("Choose a journal channel.")

    def get(self, entry_id: UUID, owner_id: UUID, lock: bool = False) -> JournalEntry:
        entry = self.repository.get(entry_id, owner_id, lock)
        if entry is None:
            raise NotFoundError("Journal entry not found")
        self.channel(entry.channel_id, owner_id)
        return entry

    def create(self, channel_id: UUID, owner_id: UUID, data: JournalCreate) -> JournalEntry:
        self.channel(channel_id, owner_id)
        entry = JournalEntry(channel_id=channel_id, author_id=owner_id, **data.model_dump())
        self.db.add(entry)
        complete_writing(self.db, channel_id, utc_now())
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def update(self, entry_id: UUID, owner_id: UUID, data: JournalUpdate) -> JournalEntry:
        entry = self.get(entry_id, owner_id, lock=True)
        if entry.revision != data.revision:
            raise ConflictError("This entry changed on another device. Your draft has been kept.")
        entry.title, entry.content = data.title, data.content
        entry.revision += 1
        entry.updated_at = utc_now()
        complete_writing(self.db, entry.channel_id, entry.updated_at)
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def remove(self, entry_id: UUID, owner_id: UUID, revision: int) -> None:
        entry = self.get(entry_id, owner_id, lock=True)
        if entry.revision != revision:
            raise ConflictError("This entry changed. Reload it before deleting.")
        self.db.delete(entry)
        self.db.commit()
