from datetime import timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.auth.models import LoginSession, User
from app.auth.repository import SessionRepository
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import AuthenticationError, ConflictError, RateLimitError
from app.core.security import generate_token, hash_token, utc_now
from app.home.service import HomeService
from app.notifications.android_schemas import PairingResponse
from app.notifications.firebase import load_configuration
from app.notifications.schemas import NotificationSettings
from app.schedule.board import schedule_board
from app.schedule.prompts.schemas import PromptResponse
from app.schedule.prompts.service import due_prompts
from app.schedule.schemas import ReminderFlag
from app.time_tracking.schemas import ActivityResponse
from app.time_tracking.service import TrackingService
from app.wear.models import WatchDevice, WatchPairing
from app.wear.schemas import WatchCredentials, WatchPairingInput, WatchSettings, WatchSnapshot


def begin_pairing(db: Session, current: AuthenticatedSession) -> PairingResponse:
    db.execute(text("SELECT pg_advisory_xact_lock(731492684)"))
    db.execute(delete(WatchPairing).where(WatchPairing.expires_at <= utc_now()))
    count = (
        db.scalar(
            select(func.count())
            .select_from(WatchPairing)
            .where(WatchPairing.session_id == current.session.id)
        )
        or 0
    )
    if count >= 5:
        raise RateLimitError("Wait five minutes before starting another watch pairing.")
    ticket = generate_token()
    expires = utc_now() + timedelta(minutes=5)
    db.add(
        WatchPairing(
            ticket_hash=hash_token(ticket), session_id=current.session.id, expires_at=expires
        )
    )
    db.commit()
    return PairingResponse(ticket=ticket, expires_at=expires)


def finish_pairing(db: Session, data: WatchPairingInput, settings: Settings) -> WatchCredentials:
    db.execute(text("SELECT pg_advisory_xact_lock(731492684)"))
    pairing = db.scalar(
        select(WatchPairing)
        .join(LoginSession)
        .where(
            WatchPairing.ticket_hash == hash_token(data.ticket.get_secret_value()),
            WatchPairing.expires_at > utc_now(),
            LoginSession.expires_at > utc_now(),
            LoginSession.revoked_at.is_(None),
        )
        .with_for_update(of=WatchPairing)
    )
    if pairing is None:
        raise AuthenticationError(
            "Watch pairing expired or was already used. Pair again from Settings."
        )
    parent = db.get(LoginSession, pairing.session_id)
    if parent is None:
        raise AuthenticationError("Sign in to pair your watch.")
    count = (
        db.scalar(
            select(func.count())
            .select_from(WatchDevice)
            .join(LoginSession)
            .where(
                LoginSession.user_id == parent.user_id,
                LoginSession.expires_at > utc_now(),
                LoginSession.revoked_at.is_(None),
            )
        )
        or 0
    )
    if count >= 10:
        raise ConflictError("Remove an old watch from Settings > Sessions before pairing another.")
    session = SessionRepository(db).create(
        user_id=parent.user_id,
        token_hash=hash_token(generate_token()),
        csrf_hash=hash_token(generate_token()),
        expires_at=utc_now() + timedelta(hours=settings.session_hours),
        user_agent=f"Noted Wear OS / {''.join(c for c in data.name if c.isprintable())}",
    )
    secret = generate_token()
    device = WatchDevice(session_id=session.id, secret_hash=hash_token(secret))
    db.add(device)
    db.delete(pairing)
    db.flush()
    result = WatchCredentials(
        origin=settings.app_origin,
        secret=secret,
        device_id=device.id,
        expires_at=session.expires_at,
    )
    db.commit()
    return result


def authenticate(db: Session, authorization: str) -> AuthenticatedSession:
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not 43 <= len(token) <= 128:
        raise AuthenticationError("Pair your watch from Settings > Watch.")
    session = db.scalar(
        select(LoginSession)
        .join(WatchDevice)
        .where(
            WatchDevice.secret_hash == hash_token(token),
            LoginSession.revoked_at.is_(None),
            LoginSession.expires_at > utc_now(),
        )
    )
    user = db.get(User, session.user_id) if session else None
    if session is None or user is None:
        raise AuthenticationError("This watch session ended. Pair again from Settings > Watch.")
    if session.last_seen_at is None or session.last_seen_at < utc_now() - timedelta(minutes=5):
        session.last_seen_at = utc_now()
        db.commit()
    return AuthenticatedSession(user=user, session=session)


def snapshot(db: Session, current: AuthenticatedSession, settings: Settings) -> WatchSnapshot:
    tracking = TrackingService(db)
    tracker = tracking.read(current.user.id)
    now = utc_now()
    config = load_configuration(settings.storage_path)
    board = schedule_board(
        db, current.user.id, now - timedelta(hours=12), now + timedelta(hours=24)
    )
    overdue = [
        ReminderFlag(
            message_id=item.id,
            revision=item.revision,
            channel_id=item.channel_id,
            channel_name=item.channel_name,
            workspace_id=item.workspace_id,
            workspace_name=item.workspace_name,
            content=item.title,
            due_at=item.due_at,
        )
        for item in HomeService(db).activity(current.user.id, 30).items
        if item.kind == "reminder"
        and item.channel_id is not None
        and item.channel_name is not None
        and item.workspace_id is not None
        and item.workspace_name is not None
    ]
    board.reminders = list({item.message_id: item for item in overdue + board.reminders}.values())
    return WatchSnapshot(
        tracker=tracker,
        activities=[
            ActivityResponse.model_validate(item)
            for item in tracking.repository.activities(current.user.id)
            if not item.archived
        ],
        board=board,
        prompts=[PromptResponse.model_validate(item) for item in due_prompts(db, current.user.id)],
        settings=WatchSettings.model_validate(current.user.watch_preferences or {}),
        notifications=NotificationSettings.model_validate(
            current.user.notification_preferences or {}
        ),
        firebase=config.client if config else None,
    )
