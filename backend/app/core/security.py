import hashlib
import secrets
from datetime import UTC, datetime

from pwdlib import PasswordHash

password_hasher = PasswordHash.recommended()
dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))


def utc_now() -> datetime:
    return datetime.now(UTC)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def tokens_match(first: str, second: str) -> bool:
    return secrets.compare_digest(first, second)


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    return password_hasher.verify(password, stored_hash or dummy_password_hash)
