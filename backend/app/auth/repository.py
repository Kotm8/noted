from datetime import datetime
from uuid import UUID

from sqlalchemy import case, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.models import AuthThrottle, Installation, LoginSession, User


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: UUID) -> User | None:
        return self.db.get(User, user_id)

    def get_for_update(self, user_id: UUID) -> User | None:
        statement = (
            select(User)
            .where(User.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def get_by_username(self, username: str) -> User | None:
        statement = select(User).where(User.username == username)
        return self.db.scalar(statement)

    def owner_exists(self) -> bool:
        return self.db.scalar(select(User.id).limit(1)) is not None

    def create(self, username: str, password_hash: str) -> User:
        user = User(username=username, password_hash=password_hash)
        self.db.add(user)
        self.db.flush()
        return user


class SessionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def find_active(self, token_hash: str, current_time: datetime) -> LoginSession | None:
        statement = select(LoginSession).where(
            LoginSession.token_hash == token_hash,
            LoginSession.live(current_time),
        )
        return self.db.scalar(statement)

    def create(
        self,
        user_id: UUID,
        token_hash: str,
        csrf_hash: str,
        expires_at: datetime,
        user_agent: str,
    ) -> LoginSession:
        session = LoginSession(
            user_id=user_id,
            token_hash=token_hash,
            csrf_hash=csrf_hash,
            expires_at=expires_at,
            user_agent=user_agent or None,
        )
        self.db.add(session)
        self.db.flush()
        return session

    def list_active(self, user_id: UUID, current_time: datetime) -> list[LoginSession]:
        statement = (
            select(LoginSession)
            .where(
                LoginSession.user_id == user_id,
                LoginSession.live(current_time),
            )
            .order_by(LoginSession.last_seen_at.desc().nulls_last(), LoginSession.id)
        )
        return list(self.db.scalars(statement))

    def revoke_for_owner(self, session_id: UUID, user_id: UUID, current_time: datetime) -> bool:
        statement = (
            update(LoginSession)
            .where(
                LoginSession.id == session_id,
                LoginSession.user_id == user_id,
                LoginSession.live(current_time),
            )
            .values(revoked_at=current_time)
            .returning(LoginSession.id)
        )
        return self.db.scalar(statement) is not None

    def revoke_for_user(self, user_id: UUID, revoked_at: datetime) -> None:
        statement = (
            update(LoginSession)
            .where(
                LoginSession.user_id == user_id,
                LoginSession.revoked_at.is_(None),
            )
            .values(revoked_at=revoked_at)
        )
        self.db.execute(statement)


class InstallationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def ensure_exists(self, secret_hash: str) -> None:
        statement = insert(Installation).values(id=1, secret_hash=secret_hash)
        statement = statement.on_conflict_do_nothing(index_elements=[Installation.id])
        self.db.execute(statement)

    def get_for_update(self) -> Installation | None:
        statement = select(Installation).where(Installation.id == 1).with_for_update()
        return self.db.scalar(statement)


class AuthThrottleRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def record_attempt(self, key: str, window_start: datetime) -> int:
        statement = insert(AuthThrottle).values(
            key=key,
            window_start=window_start,
            attempts=1,
        )
        returning_statement = statement.on_conflict_do_update(
            index_elements=[AuthThrottle.key],
            set_={
                "window_start": window_start,
                "attempts": case(
                    (AuthThrottle.window_start == window_start, AuthThrottle.attempts + 1),
                    else_=1,
                ),
            },
        ).returning(AuthThrottle.attempts)
        return int(self.db.execute(returning_statement).scalar_one())
