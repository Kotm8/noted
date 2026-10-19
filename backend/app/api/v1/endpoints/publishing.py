from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.publishing.models import ScheduledMessage, WritingPrompt
from app.publishing.schemas import (
    ScheduledFields,
    ScheduledResponse,
    ScheduledUpdate,
    WritingResponse,
    WritingUpdate,
)
from app.publishing.service import PublishingService

router = APIRouter(tags=["channel scheduling"])


@router.get("/channels/{channel_id}/scheduled-messages", response_model=list[ScheduledResponse])
def list_messages(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[ScheduledMessage]:
    return PublishingService(db).list_messages(channel_id, current.user.id)


@router.post(
    "/channels/{channel_id}/scheduled-messages", response_model=ScheduledResponse, status_code=201
)
def create_message(
    channel_id: UUID,
    data: ScheduledFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ScheduledMessage:
    return PublishingService(db).create(channel_id, current.user.id, data)


@router.put("/scheduled-messages/{message_id}", response_model=ScheduledResponse)
def update_message(
    message_id: UUID,
    data: ScheduledUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ScheduledMessage:
    return PublishingService(db).update(message_id, current.user.id, data)


@router.delete("/scheduled-messages/{message_id}", status_code=204)
def cancel_message(
    message_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    PublishingService(db).cancel(message_id, current.user.id, revision)


@router.get("/channels/{channel_id}/writing-prompt", response_model=WritingResponse | None)
def writing_prompt(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> WritingPrompt | None:
    return PublishingService(db).writing(channel_id, current.user.id)


@router.put("/channels/{channel_id}/writing-prompt", response_model=WritingResponse)
def save_writing_prompt(
    channel_id: UUID,
    data: WritingUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> WritingPrompt:
    return PublishingService(db).save_writing(channel_id, current.user.id, data)


@router.post("/channels/{channel_id}/writing-prompt/dismiss", status_code=204)
def dismiss_writing_prompt(
    channel_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    PublishingService(db).dismiss(channel_id, current.user.id, revision)
