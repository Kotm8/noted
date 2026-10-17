from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth.cookies import CSRF_COOKIE, SESSION_COOKIE
from app.auth.services.sessions import AuthenticatedSession, SessionService
from app.core.errors import ForbiddenError
from app.core.security import hash_token, tokens_match
from app.dependencies.database import get_db


def get_current_session(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthenticatedSession:
    token = request.cookies.get(SESSION_COOKIE, "")
    current = SessionService(db).authenticate(token)

    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        csrf_header = request.headers.get("x-csrf-token", "")
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        matches_cookie = bool(csrf_header) and tokens_match(csrf_header, csrf_cookie)
        matches_session = tokens_match(hash_token(csrf_header), current.session.csrf_hash)

        if not matches_cookie or not matches_session:
            raise ForbiddenError("Your session could not be verified. Reload and try again.")

    return current
