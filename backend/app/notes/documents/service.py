from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationError
from app.core.security import utc_now
from app.notes.documents.models import ChannelDocument
from app.notes.documents.repository import DocumentRepository
from app.notes.documents.schemas import DocumentResponse, DocumentUpdate
from app.publishing.repository import complete_writing
from app.workspaces.services.channels import ChannelService


class DocumentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = DocumentRepository(db)
        self.channels = ChannelService(db)

    def get(self, channel_id: UUID, owner_id: UUID) -> DocumentResponse:
        channel = self.channels.get_channel(channel_id, owner_id)
        if channel.kind != "document":
            raise ValidationError("Choose a Notes channel.")
        document = self.repository.get(channel_id)
        if document:
            return DocumentResponse.model_validate(document)
        return DocumentResponse(
            channel_id=channel_id,
            content="",
            revision=0,
            created_at=channel.created_at,
            updated_at=channel.created_at,
        )

    def update(self, channel_id: UUID, owner_id: UUID, data: DocumentUpdate) -> ChannelDocument:
        self.get(channel_id, owner_id)
        document = self.repository.get(channel_id, lock=True)
        self.get(channel_id, owner_id)
        if (document.revision if document else 0) != data.revision:
            raise ConflictError("This note changed on another device. Your draft has been kept.")
        if document is None:
            document = ChannelDocument(channel_id=channel_id, content=data.content)
            self.db.add(document)
        else:
            document.content = data.content
            document.revision += 1
        document.updated_at = utc_now()
        if data.content.strip():
            complete_writing(self.db, channel_id, document.updated_at)
        self.db.commit()
        self.db.refresh(document)
        return document
