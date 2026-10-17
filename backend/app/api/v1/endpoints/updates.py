from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.server.lock import admin_request_lock
from app.server.schemas.updates import ApplyUpdate, UpdateJob, UpdateStatus
from app.server.services.updates import UpdateService

router = APIRouter(prefix="/updates", tags=["updates"])


@router.get("/status", response_model=UpdateStatus)
def get_update_status(
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> UpdateStatus:
    return UpdateService(settings).status()


@router.post("/check", status_code=202)
def check_updates(
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, str]:
    UpdateService(settings).check()
    return {"status": "queued"}


@router.post("/apply", response_model=UpdateJob, status_code=202)
def apply_update(
    data: ApplyUpdate,
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> UpdateJob:
    with admin_request_lock(db):
        return UpdateService(settings).apply(data, str(current.user.id))
