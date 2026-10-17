from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.repository import InstallationRepository, SessionRepository, UserRepository
from app.auth.schemas import LoginRequest, PasswordChangeRequest, SetupRequest
from app.auth.services.rate_limit import RateLimitService
from app.auth.services.sessions import SessionService, SessionTokens
from app.core.config import Settings
from app.core.errors import AuthenticationError, ForbiddenError
from app.core.security import (
    generate_token,
    hash_password,
    hash_token,
    tokens_match,
    utc_now,
    verify_password,
)


@dataclass(frozen=True)
class AuthenticationResult:
    user: User
    tokens: SessionTokens


class AuthService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.installation = InstallationRepository(db)
        self.sessions = SessionService(db)
        self.rate_limit = RateLimitService(db)

    def is_setup_required(self) -> bool:
        return not self.users.owner_exists()

    def generate_setup_secret(self) -> str:
        secret = generate_token()
        self.installation.ensure_exists(hash_token(secret))
        installation = self.installation.get_for_update()

        if installation is None or installation.claimed_at is not None or self.users.owner_exists():
            raise ForbiddenError(
                "This installation already has an owner. Setup cannot be reopened."
            )

        installation.secret_hash = hash_token(secret)
        self.db.commit()
        return secret

    def setup_owner(
        self,
        data: SetupRequest,
        settings: Settings,
        client_address: str,
        user_agent: str = "",
    ) -> AuthenticationResult:
        self.rate_limit.check_login_attempt(client_address)
        installation = self.installation.get_for_update()

        if installation is None or installation.claimed_at is not None:
            raise ForbiddenError("Setup is unavailable")

        supplied_hash = hash_token(data.setup_secret.get_secret_value())
        if not tokens_match(installation.secret_hash, supplied_hash):
            raise ForbiddenError("The installation secret is incorrect")

        user = self.users.create(
            username=data.username,
            password_hash=hash_password(data.password.get_secret_value()),
        )
        installation.claimed_at = utc_now()
        installation.secret_hash = hash_token(generate_token())
        tokens = self.sessions.create(user, settings, user_agent)
        self.db.commit()
        self.db.refresh(user)
        return AuthenticationResult(user=user, tokens=tokens)

    def login(
        self,
        data: LoginRequest,
        settings: Settings,
        client_address: str,
        user_agent: str = "",
    ) -> AuthenticationResult:
        self.rate_limit.check_login_attempt(client_address)
        user = self.users.get_by_username(data.username)
        stored_hash = user.password_hash if user is not None else None
        valid_password = verify_password(data.password.get_secret_value(), stored_hash)

        if user is None or not valid_password:
            raise AuthenticationError("Incorrect username or password")

        tokens = self.sessions.create(user, settings, user_agent)
        self.db.commit()
        self.db.refresh(user)
        return AuthenticationResult(user=user, tokens=tokens)

    def provision_owner(self, data: LoginRequest) -> User:
        self.installation.ensure_exists(hash_token(generate_token()))
        installation = self.installation.get_for_update()
        if installation is None or installation.claimed_at is not None or self.users.owner_exists():
            raise ForbiddenError("This installation already has an owner.")
        user = self.users.create(
            username=data.username,
            password_hash=hash_password(data.password.get_secret_value()),
        )
        installation.claimed_at = utc_now()
        installation.secret_hash = hash_token(generate_token())
        self.db.commit()
        self.db.refresh(user)
        return user

    def change_password(
        self,
        data: PasswordChangeRequest,
        user: User,
        settings: Settings,
        client_address: str,
        user_agent: str = "",
    ) -> AuthenticationResult:
        self.rate_limit.check_login_attempt(client_address)
        if not verify_password(data.current_password.get_secret_value(), user.password_hash):
            raise AuthenticationError("The current password is incorrect")

        user.password_hash = hash_password(data.new_password.get_secret_value())
        user.updated_at = utc_now()
        SessionRepository(self.db).revoke_for_user(user.id, utc_now())
        tokens = self.sessions.create(user, settings, user_agent)
        self.db.commit()
        self.db.refresh(user)
        return AuthenticationResult(user=user, tokens=tokens)
