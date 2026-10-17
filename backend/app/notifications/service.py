import base64
from uuid import UUID

from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.errors import ValidationError
from app.core.security import utc_now
from app.notifications.models import DevicePresence, NotificationKey, PushSubscription
from app.notifications.schemas import PresenceInput, SubscriptionInput


def notification_key(db: Session) -> tuple[str, str]:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    db.execute(text("SELECT pg_advisory_xact_lock(731492682)"))
    record = db.get(NotificationKey, 1)
    if record is None:
        key = ec.generate_private_key(ec.SECP256R1())
        record = NotificationKey(
            id=1,
            private_key=key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ).decode(),
        )
        db.add(record)
        db.commit()
    loaded = serialization.load_pem_private_key(record.private_key.encode(), password=None)
    if not isinstance(loaded, ec.EllipticCurvePrivateKey):
        raise ValueError("Invalid notification signing key")
    raw = loaded.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode(), record.private_key


def save_subscription(db: Session, current: AuthenticatedSession, data: SubscriptionInput) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(731492683)"))
    subscription = db.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == data.endpoint)
    )
    count = (
        db.scalar(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.session_id == current.session.id)
        )
        or 0
    )
    if subscription is None and count >= 20:
        raise ValidationError("Too many notification devices. Disable an old device first.")
    if subscription is None:
        subscription = PushSubscription(endpoint=data.endpoint)
        db.add(subscription)
    subscription.session_id = current.session.id
    subscription.device_id = data.device_id
    subscription.kind = data.kind
    subscription.keys = data.keys.model_dump()
    db.commit()


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
