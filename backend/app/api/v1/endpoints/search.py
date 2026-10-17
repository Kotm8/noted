from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.search.schemas import SearchPage
from app.search.service import SearchService

router = APIRouter(tags=["search"])


@router.get("/search", response_model=SearchPage)
def search_notes(
    q: str = Query(min_length=2, max_length=200),
    workspace_id: UUID | None = None,
    channel_id: UUID | None = None,
    sort: Literal["newest", "oldest"] = "newest",
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SearchPage:
    return SearchService(db).search(
        current.user.id, q, workspace_id, channel_id, sort, limit, offset
    )
