from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth.cookies import clear_session_cookies, set_session_cookies
from app.auth.models import User
from app.auth.schemas import LoginRequest, SessionResponse, SetupRequest, UserResponse
from app.auth.services.auth import AuthService
from app.auth.services.sessions import AuthenticatedSession, SessionService
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.get("/status")
def get_setup_status(db: Session = Depends(get_db)) -> dict[str, bool]:
    return {"setup_required": AuthService(db).is_setup_required()}


@router.post("/setup", response_model=UserResponse, status_code=201)
def setup_owner(
    data: SetupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    client_address = request.client.host if request.client else "unknown"
    result = AuthService(db).setup_owner(
        data, settings, client_address, request.headers.get("user-agent", "")
    )
    set_session_cookies(response, result.tokens, settings)
    return result.user


@router.post("/login", response_model=UserResponse)
def login(
    data: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    client_address = request.client.host if request.client else "unknown"
    result = AuthService(db).login(
        data, settings, client_address, request.headers.get("user-agent", "")
    )
    set_session_cookies(response, result.tokens, settings)
    return result.user


@router.get("/session", response_model=UserResponse)
def get_session(current: AuthenticatedSession = Depends(get_current_session)) -> User:
    return current.user


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    SessionService(db).revoke(current.session)
    clear_session_cookies(response)


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[SessionResponse]:
    return SessionService(db).list_active(current)


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(
    session_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    SessionService(db).revoke_by_id(session_id, current.user.id)
    if session_id == current.session.id:
        clear_session_cookies(response)
