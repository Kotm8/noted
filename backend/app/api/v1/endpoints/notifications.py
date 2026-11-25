from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings as get_app_settings
from app.dependencies.database import get_db
from app.notifications.diagnostics import send_phone_test
from app.notifications.schemas import (
    NotificationSettings,
    PresenceInput,
    PushTestResult,
)
from app.notifications.service import (
    remove_subscription,
    save_presence,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/reconcile")
def reconcile(
    items: list[str] = Query(default=[], max_length=100),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, list[str]]:
    from app.notifications.reconciliation import stale_notifications

    return {"stale": stale_notifications(db, current.user.id, items)}


@router.post("/test", response_model=PushTestResult)
def test_push(
    device_id: UUID | None = None,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_app_settings),
) -> PushTestResult:
    return send_phone_test(db, current, settings, device_id)


@router.get("/settings", response_model=NotificationSettings)
def get_settings(
    current: AuthenticatedSession = Depends(get_current_session),
) -> NotificationSettings:
    return NotificationSettings.model_validate(current.user.notification_preferences or {})


@router.put("/settings", response_model=NotificationSettings)
def settings(
    data: NotificationSettings,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> NotificationSettings:
    current.user.notification_preferences = data.model_dump()
    db.commit()
    return data


@router.delete("/subscriptions/{device_id}", status_code=204)
def unsubscribe(
    device_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    remove_subscription(db, current.session.id, device_id)


@router.post("/presence", status_code=204)
def presence(
    data: PresenceInput,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    save_presence(db, current.session.id, data)
