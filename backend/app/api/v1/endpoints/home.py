from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.home.schemas import HomeActivityPage, ReadActivities
from app.home.service import HomeService

router = APIRouter(prefix="/home", tags=["home"])


@router.get("/activity", response_model=HomeActivityPage)
def activity(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> HomeActivityPage:
    return HomeService(db).activity(current.user.id, limit)


@router.post("/activity/read", status_code=204)
def read(
    data: ReadActivities,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    HomeService(db).read(current.user.id, data)
