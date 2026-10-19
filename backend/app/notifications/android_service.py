from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.auth.services.sessions import AuthenticatedSession
from app.core.errors import AuthenticationError, ConflictError, RateLimitError
from app.core.security import generate_token, hash_token, tokens_match, utc_now
from app.notifications.android_schemas import PairingCompletion, PairingResponse
from app.notifications.firebase import FirebaseConfiguration
from app.notifications.models import AndroidPairing, PushSubscription


def start_pairing(db: Session, current: AuthenticatedSession, device_id: UUID) -> PairingResponse:
    db.execute(text("SELECT pg_advisory_xact_lock(731492683)"))
    db.execute(delete(AndroidPairing).where(AndroidPairing.expires_at <= utc_now()))
    pending = (
        db.scalar(
            select(func.count())
            .select_from(AndroidPairing)
            .where(AndroidPairing.session_id == current.session.id)
        )
        or 0
    )
    if pending >= 5:
        raise RateLimitError("Too many pairing attempts. Wait five minutes and try again.")
    ticket = generate_token()
    expires = utc_now() + timedelta(minutes=5)
    db.add(
        AndroidPairing(
            ticket_hash=hash_token(ticket),
            session_id=current.session.id,
            device_id=device_id,
            expires_at=expires,
        )
    )
    db.commit()
    return PairingResponse(ticket=ticket, expires_at=expires)


def pairing(db: Session, ticket: str) -> AndroidPairing:
    row = db.scalar(
        select(AndroidPairing)
        .join(LoginSession)
        .where(
            AndroidPairing.ticket_hash == hash_token(ticket),
            AndroidPairing.expires_at > utc_now(),
            LoginSession.revoked_at.is_(None),
            LoginSession.expires_at > utc_now(),
        )
        .with_for_update(of=AndroidPairing)
    )
    if row is None:
        raise AuthenticationError(
            "Pairing expired. Enable notifications again from the signed-in app."
        )
    return row


def native_endpoint(configuration: FirebaseConfiguration, token: str) -> str:
    import re

    if not re.fullmatch(r"[A-Za-z0-9:_-]{20,4096}", token):
        raise ConflictError("The phone registration token is invalid. Enable notifications again.")
    return f"fcm:{configuration.client.project_id}:{token}"


def finish_pairing(
    db: Session, data: PairingCompletion, configuration: FirebaseConfiguration
) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(731492683)"))
    row = pairing(db, data.ticket.get_secret_value())
    endpoint = native_endpoint(configuration, data.token.get_secret_value())
    secret_hash = hash_token(data.secret.get_secret_value())
    if row.used_at:
        existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
        if (
            existing
            and existing.session_id == row.session_id
            and existing.device_id == row.device_id
            and tokens_match(existing.keys.get("device_secret_hash", ""), secret_hash)
        ):
            return
        raise ConflictError("This pairing has already been used. Enable notifications again.")
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    count = (
        db.scalar(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.session_id == row.session_id)
        )
        or 0
    )
    if not existing and count >= 20:
        raise ConflictError("Too many notification devices. Disable an old device first.")
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.session_id == row.session_id,
            PushSubscription.device_id == row.device_id,
            PushSubscription.endpoint != endpoint,
        )
    )
    if existing is None:
        existing = PushSubscription(endpoint=endpoint)
        db.add(existing)
    existing.session_id, existing.device_id, existing.kind = row.session_id, row.device_id, "mobile"
    existing.keys = {
        "device_secret_hash": secret_hash,
        "project_id": configuration.client.project_id,
    }
    row.used_at = utc_now()
    db.commit()


def authenticate_device(db: Session, authorization: str) -> tuple[PushSubscription, LoginSession]:
    prefix, _, secret = authorization.partition(" ")
    if prefix != "Bearer" or not 43 <= len(secret) <= 128:
        raise AuthenticationError("Enable phone notifications again to reconnect this device.")
    result = db.execute(
        select(PushSubscription, LoginSession)
        .join(LoginSession)
        .where(
            PushSubscription.endpoint.like("fcm:%"),
            PushSubscription.keys["device_secret_hash"].astext == hash_token(secret),
            LoginSession.revoked_at.is_(None),
            LoginSession.expires_at > utc_now(),
        )
    ).first()
    if result is None:
        raise AuthenticationError(
            "This phone notification session has ended. Sign in and enable notifications again."
        )
    return result[0], result[1]
