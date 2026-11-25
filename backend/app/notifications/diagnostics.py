import json
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import ConflictError
from app.notifications.delivery import send_push
from app.notifications.models import PushSubscription
from app.notifications.schemas import PushTestResult
from app.wear.models import WatchDevice


def send_phone_test(
    db: Session, current: AuthenticatedSession, settings: Settings, device_id: UUID | None = None
) -> PushTestResult:
    subscriptions = db.scalars(
        select(PushSubscription)
        .join(LoginSession)
        .outerjoin(WatchDevice, WatchDevice.session_id == LoginSession.id)
        .where(
            LoginSession.user_id == current.user.id,
            LoginSession.live(),
            PushSubscription.kind == "mobile",
            PushSubscription.endpoint.startswith("fcm:"),
            WatchDevice.id.is_(None),
            *(
                (PushSubscription.device_id == device_id, LoginSession.id == current.session.id)
                if device_id
                else ()
            ),
        )
    ).all()
    if not subscriptions:
        raise ConflictError(
            "No phone is subscribed. Sign in on your phone and enable notifications."
        )
    payload = json.dumps(
        {
            "kind": "diagnostic",
            "testId": str(uuid4()),
            "title": f"{settings.server_name} / Push test",
            "body": "This phone received a test alert from your Noted server.",
            "url": "/",
        }
    )
    result = PushTestResult()
    for subscription in subscriptions:
        outcome = send_push(subscription, settings.app_origin, payload, ttl=60, settings=settings)
        if outcome == "accepted":
            result.accepted += 1
        elif outcome == "expired":
            result.expired += 1
            db.delete(subscription)
        else:
            result.failed += 1
    db.commit()
    return result
