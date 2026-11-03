import os
import re

from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.auth.schemas import LoginRequest
from app.auth.services.auth import AuthService
from app.db.database import create_database_engine

BROWSER_PASSWORD = "browser-test-password-only"


def reset_browser_state(database_url: str, schema: str) -> None:
    if not re.fullmatch(r"noted_browser_[0-9a-f]{32}", schema):
        raise ValueError("Browser tests can only reset their disposable schema.")
    if make_url(database_url).query.get("options") != f"-csearch_path={schema}":
        raise ValueError("The browser test database does not match its disposable schema.")
    engine = create_database_engine(database_url)
    try:
        with Session(engine) as db:
            if db.scalar(text("SELECT current_schema()")) != schema:
                raise ValueError("The browser test schema is unavailable.")
            tables = inspect(db.connection()).get_table_names(schema=schema)
            quote = engine.dialect.identifier_preparer.quote
            selected = ", ".join(
                f"{quote(schema)}.{quote(table)}" for table in tables if table != "alembic_version"
            )
            db.execute(text("SET LOCAL lock_timeout = '5s'"))
            db.execute(text(f"TRUNCATE TABLE {selected} RESTART IDENTITY"))
            AuthService(db).provision_owner(
                LoginRequest.model_validate({"username": "ilya", "password": BROWSER_PASSWORD})
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    reset_browser_state(os.environ["NOTED_DATABASE_URL"], os.environ["NOTED_BROWSER_TEST_SCHEMA"])
