from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.notes.documents.models import ChannelDocument
from app.notes.documents.schemas import DocumentResponse, DocumentUpdate
from app.notes.documents.service import DocumentService

router = APIRouter(tags=["notes"])


@router.get("/channels/{channel_id}/document", response_model=DocumentResponse)
def get_document(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DocumentResponse:
    return DocumentService(db).get(channel_id, current.user.id)


@router.put("/channels/{channel_id}/document", response_model=DocumentResponse)
def update_document(
    channel_id: UUID,
    data: DocumentUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ChannelDocument:
    return DocumentService(db).update(channel_id, current.user.id, data)
