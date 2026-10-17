from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.cookies import set_session_cookies
from app.auth.models import User
from app.auth.schemas import AppearancePreferences, PasswordChangeRequest, UserResponse
from app.auth.services.appearance import AppearanceService
from app.auth.services.auth import AuthService
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.server.schemas.settings import ServerSettingsResponse
from app.server.services.settings import ServerService

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/appearance", response_model=AppearancePreferences | None)
def get_appearance(
    current: AuthenticatedSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> AppearancePreferences | None:
    return AppearanceService(db).read(current.user)


@router.put("/appearance", response_model=AppearancePreferences)
def save_appearance(
    data: AppearancePreferences,
    initialize: bool = False,
    current: AuthenticatedSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> AppearancePreferences:
    return AppearanceService(db).save(current.user, data, initialize)


@router.get("/server", response_model=ServerSettingsResponse)
def get_server_settings(
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> ServerSettingsResponse:
    return ServerService(db).get_settings(settings, current.user)


@router.put("/password", response_model=UserResponse)
def change_owner_password(
    data: PasswordChangeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> User:
    address = request.client.host if request.client else "unknown"
    result = AuthService(db).change_password(
        data, current.user, settings, address, request.headers.get("user-agent", "")
    )
    set_session_cookies(response, result.tokens, settings)
    return result.user
