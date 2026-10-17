from sqlalchemy.orm import Session

from app.auth.repository import AuthThrottleRepository
from app.core.errors import RateLimitError
from app.core.security import hash_token, utc_now


class RateLimitService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = AuthThrottleRepository(db)

    def check_login_attempt(self, client_address: str) -> None:
        window_start = utc_now().replace(second=0, microsecond=0)
        client_attempts = self.repository.record_attempt(hash_token(client_address), window_start)
        global_attempts = self.repository.record_attempt("global", window_start)
        self.db.commit()

        if client_attempts > 10 or global_attempts > 100:
            raise RateLimitError("Too many attempts. Try again in a minute.")
