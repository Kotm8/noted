import json
from typing import Any, cast
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.orm import Session, SessionTransaction

from app.live.topics import LiveEvent, Topic, row_events

CHANNEL = "noted_live"


def pending(db: Session) -> set[LiveEvent]:
    if not db.in_transaction():
        db.begin()
    transaction = db.get_nested_transaction() or db.get_transaction()
    changes = cast(
        dict[SessionTransaction | None, set[LiveEvent]], db.info.setdefault("live_changes", {})
    )
    return changes.setdefault(transaction, set())


def mark(db: Session, topic: Topic, *, user: UUID, **ids: Any) -> None:
    pending(db).add(LiveEvent(topic=topic, user=user, **ids))


@event.listens_for(Session, "after_flush")
def collect(db: Session, _context: Any) -> None:
    touched = [*db.new, *db.deleted, *(row for row in db.dirty if db.is_modified(row))]
    with db.no_autoflush:
        for row in touched:
            pending(db).update(row_events(db, row))


@event.listens_for(Session, "before_commit")
def announce(db: Session) -> None:
    db.flush()
    if db.in_nested_transaction():
        return
    events = pending(db)
    if not events:
        return
    schema = db.scalar(text("SELECT current_schema()"))
    for item in events:
        payload = json.dumps({"schema": schema, **item.payload()}, separators=(",", ":"))
        db.execute(
            text("SELECT pg_notify(:channel, :payload)"), {"channel": CHANNEL, "payload": payload}
        )


@event.listens_for(Session, "after_commit")
def clear_committed(db: Session) -> None:
    changes = db.info.get("live_changes", {})
    if nested := db.get_nested_transaction():
        changes.setdefault(nested.parent, set()).update(changes.pop(nested, set()))
    else:
        db.info.pop("live_changes", None)


@event.listens_for(Session, "after_soft_rollback")
def clear_rolled_back(db: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is None:
        db.info.pop("live_changes", None)
    else:
        db.info.get("live_changes", {}).pop(transaction, None)
