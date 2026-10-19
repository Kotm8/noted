from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.notes.models import Message
from app.notes.schemas import MessageCreate, MessageResponse
from app.threads.schemas import ThreadPage
from app.threads.service import ThreadService

router = APIRouter(tags=["threads"])


@router.get("/messages/{message_id}/thread", response_model=ThreadPage)
def read_thread(
    message_id: UUID,
    before: str | None = Query(default=None, max_length=256),
    after: str | None = Query(default=None, max_length=256),
    around: UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ThreadPage:
    return ThreadService(db).read(message_id, current.user.id, before, limit, after, around)


@router.post("/messages/{message_id}/thread", response_model=MessageResponse, status_code=201)
def reply_to_thread(
    message_id: UUID,
    data: MessageCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Message:
    return ThreadService(db).reply(message_id, current.user.id, data)
