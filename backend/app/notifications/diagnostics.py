import json
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import LoginSession
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import ConflictError
from app.notifications.delivery import send_push
from app.notifications.models import PushSubscription
from app.notifications.schemas import PushTestResult
from app.notifications.service import notification_key


def send_phone_test(
    db: Session, current: AuthenticatedSession, settings: Settings
) -> PushTestResult:
    subscriptions = db.scalars(
        select(PushSubscription)
        .join(LoginSession)
        .where(
            LoginSession.user_id == current.user.id,
            LoginSession.live(),
            PushSubscription.kind == "mobile",
        )
    ).all()
    if not subscriptions:
        raise ConflictError(
            "No phone is subscribed. Sign in on your phone and enable notifications."
        )
    _, private_key = notification_key(db)
    payload = json.dumps(
        {
            "kind": "diagnostic",
            "testId": str(uuid4()),
            "title": f"{settings.server_name} / Push test",
            "body": "Server-to-phone notifications are working.",
            "url": "/",
        }
    )
    result = PushTestResult()
    for subscription in subscriptions:
        outcome = send_push(
            subscription, private_key, settings.app_origin, payload, ttl=60, settings=settings
        )
        if outcome == "accepted":
            result.accepted += 1
        elif outcome == "expired":
            result.expired += 1
            db.delete(subscription)
        else:
            result.failed += 1
    db.commit()
    return result
