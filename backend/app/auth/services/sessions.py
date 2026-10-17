from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

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
        self.sessions.create(
            user_id=user.id,
            token_hash=hash_token(token),
            csrf_hash=hash_token(csrf_token),
            expires_at=utc_now() + timedelta(hours=settings.session_hours),
            user_agent="".join(c for c in user_agent if c.isprintable())[:512],
        )
        return SessionTokens(
            token=token,
            csrf_token=csrf_token,
            max_age=settings.session_hours * 3600,
        )

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
