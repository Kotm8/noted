from fastapi import Response

from app.auth.services.sessions import SessionTokens
from app.core.config import Settings

SESSION_COOKIE = "noted_session"
CSRF_COOKIE = "noted_csrf"


def set_session_cookies(response: Response, tokens: SessionTokens, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        tokens.token,
        max_age=tokens.max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api",
    )
    response.set_cookie(
        CSRF_COOKIE,
        tokens.csrf_token,
        max_age=tokens.max_age,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/api")
    response.delete_cookie(CSRF_COOKIE, path="/")
