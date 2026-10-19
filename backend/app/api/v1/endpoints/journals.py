from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.journals.models import JournalEntry
from app.journals.schemas import JournalCreate, JournalResponse, JournalSummary, JournalUpdate
from app.journals.service import JournalService

router = APIRouter(tags=["journals"])


@router.get("/channels/{channel_id}/journal", response_model=list[JournalSummary])
def list_entries(
    channel_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[JournalEntry]:
    service = JournalService(db)
    service.channel(channel_id, current.user.id)
    return service.repository.list(channel_id, limit, offset)


@router.post("/channels/{channel_id}/journal", response_model=JournalResponse, status_code=201)
def create_entry(
    channel_id: UUID,
    data: JournalCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> JournalEntry:
    return JournalService(db).create(channel_id, current.user.id, data)


@router.get("/journal/{entry_id}", response_model=JournalResponse)
def get_entry(
    entry_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> JournalEntry:
    return JournalService(db).get(entry_id, current.user.id)


@router.put("/journal/{entry_id}", response_model=JournalResponse)
def update_entry(
    entry_id: UUID,
    data: JournalUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> JournalEntry:
    return JournalService(db).update(entry_id, current.user.id, data)


@router.delete("/journal/{entry_id}", status_code=204)
def delete_entry(
    entry_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    JournalService(db).remove(entry_id, current.user.id, revision)
