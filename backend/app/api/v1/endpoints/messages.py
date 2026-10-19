from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.notes.models import Message
from app.notes.schemas import MessageCreate, MessagePage, MessageResponse, MessageUpdate
from app.notes.services.messages import MessageService

router = APIRouter(tags=["messages"])


@router.get("/channels/{channel_id}/messages", response_model=MessagePage)
def list_messages(
    channel_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    before: str | None = Query(default=None, max_length=256),
    after: str | None = Query(default=None, max_length=256),
    around: UUID | None = None,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> MessagePage:
    return MessageService(db).list_messages(
        channel_id, current.user.id, limit, before, after, around
    )


@router.post("/channels/{channel_id}/messages", response_model=MessageResponse, status_code=201)
def create_message(
    channel_id: UUID,
    data: MessageCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Message:
    return MessageService(db).create_message(channel_id, data, current.user.id)


@router.put("/messages/{message_id}", response_model=MessageResponse)
def update_message(
    message_id: UUID,
    data: MessageUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Message:
    return MessageService(db).update_message(message_id, data, current.user.id)


@router.delete("/messages/{message_id}", status_code=204)
def delete_message(
    message_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    MessageService(db).delete_message(message_id, current.user.id)
