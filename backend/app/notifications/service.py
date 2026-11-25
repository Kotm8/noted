from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.notifications.models import DevicePresence, PushSubscription
from app.notifications.schemas import PresenceInput


def remove_subscription(db: Session, session_id: UUID, device_id: UUID) -> None:
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.session_id == session_id, PushSubscription.device_id == device_id
        )
    )
    db.commit()


def save_presence(db: Session, session_id: UUID, data: PresenceInput) -> None:
    values = {**data.model_dump(), "session_id": session_id, "seen_at": utc_now()}
    statement = insert(DevicePresence).values(**values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[DevicePresence.session_id, DevicePresence.device_id],
            set_={name: values[name] for name in ("focused", "kind", "seen_at")},
        )
    )
    db.commit()
