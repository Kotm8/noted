from sqlalchemy import create_engine
from sqlalchemy.engine import Engine


def create_database_engine(database_url: str) -> Engine:
    if not database_url.startswith("postgresql+psycopg://"):
        raise ValueError("Noted requires a postgresql+psycopg database URL")

    return create_engine(
        database_url,
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
    )
