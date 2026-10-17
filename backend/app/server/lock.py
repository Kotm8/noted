from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session


@contextmanager
def admin_request_lock(db: Session) -> Iterator[None]:
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(731492682)"))
        yield
    finally:
        db.rollback()
