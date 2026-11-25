from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.auth.repository import SessionRepository, UserRepository
from app.auth.schemas import SessionResponse
from app.core.config import Settings
from app.core.errors import AuthenticationError, NotFoundError
from app.core.security import generate_token, hash_token, utc_now


@dataclass(frozen=True)
class SessionTokens:
    token: str
    csrf_token: str
    max_age: int


@dataclass(frozen=True)
class AuthenticatedSession:
    user: User
    session: LoginSession


class SessionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.sessions = SessionRepository(db)
        self.users = UserRepository(db)

    def create(self, user: User, settings: Settings, user_agent: str = "") -> SessionTokens:
        token = generate_token()
        csrf_token = generate_token()
        hours = min(settings.session_hours, settings.session_absolute_hours)
        self.sessions.create(
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_hash=hash_token(csrf_token),
            expires_at=utc_now() + timedelta(hours=hours),
            user_agent="".join(c for c in user_agent if c.isprintable())[:512],
        )
        return SessionTokens(
            token=token,
            csrf_token=csrf_token,
            max_age=hours * 3600,
        )

    def renew(
        self, current: AuthenticatedSession, token: str, csrf: str, settings: Settings
    ) -> SessionTokens:
        max_age = self.extend(current, settings.session_hours, settings.session_absolute_hours)
        return SessionTokens(token=token, csrf_token=csrf, max_age=max_age)

    def extend(self, current: AuthenticatedSession, idle_hours: int, absolute_hours: int) -> int:
        session = self.db.scalar(
            select(LoginSession)
            .where(LoginSession.id == current.session.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        now = utc_now()
        if session is None or session.revoked_at is not None or session.expires_at <= now:
            raise AuthenticationError("Sign in to continue")
        if session.created_at is None:
            return max(1, int((session.expires_at - now).total_seconds()))
        deadline = session.created_at + timedelta(hours=absolute_hours)
        expires = min(deadline, now + timedelta(hours=idle_hours))
        if expires <= now:
            raise AuthenticationError("Sign in to continue")
        cadence = timedelta(hours=min(6.0, idle_hours / 4))
        if (
            expires - session.expires_at >= cadence
            or session.expires_at - now <= cadence
            or session.expires_at > deadline
        ):
            session.expires_at = expires
        max_age = max(1, int((session.expires_at - now).total_seconds()))
        self.db.commit()
        return max_age

    def authenticate(self, token: str) -> AuthenticatedSession:
        session = self.sessions.find_active(hash_token(token), utc_now())
        if session is None:
            raise AuthenticationError("Sign in to continue")

        user = self.users.get_by_id(session.user_id)
        if user is None:
            raise AuthenticationError("Sign in to continue")

        current_time = utc_now()
        if session.last_seen_at is None or session.last_seen_at < current_time - timedelta(
            minutes=5
        ):
            session.last_seen_at = current_time
            self.db.commit()
        return AuthenticatedSession(user=user, session=session)

    def list_active(self, current: AuthenticatedSession) -> list[SessionResponse]:
        return [
            SessionResponse(
                id=session.id,
                created_at=session.created_at,
                last_seen_at=session.last_seen_at,
                expires_at=session.expires_at,
                user_agent=session.user_agent,
                is_current=session.id == current.session.id,
            )
            for session in self.sessions.list_active(current.user.id, utc_now())
        ]

    def revoke_by_id(self, session_id: UUID, owner_id: UUID) -> None:
        if not self.sessions.revoke_for_owner(session_id, owner_id, utc_now()):
            raise NotFoundError("Active session not found")
        self.db.commit()

    def revoke(self, session: LoginSession) -> None:
        session.revoked_at = utc_now()
        self.db.commit()
