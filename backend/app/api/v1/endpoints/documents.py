from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.notes.documents.models import ChannelDocument
from app.notes.documents.reminders.models import DocumentReminder
from app.notes.documents.reminders.schemas import (
    DocumentReminderCreate,
    DocumentReminderResponse,
    DocumentReminderUpdate,
)
from app.notes.documents.reminders.service import DocumentReminderService
from app.notes.documents.schemas import DocumentResponse, DocumentUpdate
from app.notes.documents.service import DocumentService
from app.reminders.schemas import ReminderAction

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


@router.get(
    "/channels/{channel_id}/document/reminders", response_model=list[DocumentReminderResponse]
)
def list_reminders(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[DocumentReminder]:
    return DocumentReminderService(db).list(channel_id, current.user.id)


@router.post("/channels/{channel_id}/document/reminders", response_model=DocumentReminderResponse)
def create_reminder(
    channel_id: UUID,
    data: DocumentReminderCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DocumentReminder:
    return DocumentReminderService(db).create(channel_id, current.user.id, data)


@router.put("/document-reminders/{identifier}", response_model=DocumentReminderResponse)
def update_reminder(
    identifier: UUID,
    data: DocumentReminderUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DocumentReminder:
    return DocumentReminderService(db).update(identifier, current.user.id, data)


@router.post("/document-reminders/{identifier}/actions", response_model=DocumentReminderResponse)
def act_on_reminder(
    identifier: UUID,
    data: ReminderAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DocumentReminder:
    return DocumentReminderService(db).act(identifier, current.user.id, data)


@router.delete("/document-reminders/{identifier}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder(
    identifier: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Response:
    DocumentReminderService(db).remove(identifier, current.user.id, revision)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
