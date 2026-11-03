import os
import re
from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.db.database import create_database_engine
from app.writing_nudges.models import WritingNudgeRun
from app.writing_nudges.worker import advance_nudges


def make_nudges_due() -> None:
    url = os.environ["NOTED_DATABASE_URL"]
    schema = os.environ["NOTED_BROWSER_TEST_SCHEMA"]
    if not re.fullmatch(r"noted_browser_[0-9a-f]{32}", schema):
        raise ValueError("Writing nudge tests require a disposable browser schema")
    if make_url(url).query.get("options") != f"-csearch_path={schema}":
        raise ValueError("The test database does not match its disposable schema")
    engine = create_database_engine(url)
    try:
        now = utc_now()
        with Session(engine) as db:
            db.execute(
                update(WritingNudgeRun)
                .where(WritingNudgeRun.resumed_at.is_not(None))
                .values(next_at=now - timedelta(seconds=1), remaining_seconds=0)
            )
            db.commit()
        advance_nudges(engine, now)
    finally:
        engine.dispose()


if __name__ == "__main__":
    make_nudges_due()
