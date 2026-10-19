from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import ConflictError
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.notifications.android_schemas import (
    AndroidStatus,
    NativeReminderAction,
    PairingCompletion,
    PairingConfiguration,
    PairingRequest,
    PairingResponse,
    TicketInput,
    TokenInput,
)
from app.notifications.android_service import (
    authenticate_device,
    finish_pairing,
    native_endpoint,
    pairing,
    start_pairing,
)
from app.notifications.firebase import (
    FirebaseConfiguration,
    FirebaseInput,
    load_configuration,
    save_configuration,
)
from app.notifications.models import PushSubscription
from app.reminders.schemas import ReminderAction
from app.reminders.service import ReminderService

router = APIRouter(prefix="/notifications/android", tags=["notifications"])


def require_configuration(settings: Settings) -> FirebaseConfiguration:
    configuration = load_configuration(settings.storage_path)
    if configuration is None:
        raise ConflictError(
            "Configure Firebase in Settings > Notifications before enabling Android delivery."
        )
    return configuration


@router.get("/status", response_model=AndroidStatus)
def status(
    device_id: UUID | None = None,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> AndroidStatus:
    configuration = load_configuration(settings.storage_path)
    subscribed = (
        configuration is not None
        and db.scalar(
            select(PushSubscription.id)
            .where(
                PushSubscription.session_id == current.session.id,
                PushSubscription.device_id == device_id,
                PushSubscription.endpoint.startswith(f"fcm:{configuration.client.project_id}:"),
            )
            .limit(1)
        )
        is not None
    )
    return AndroidStatus(
        configured=configuration is not None,
        subscribed=subscribed,
        project_id=configuration.client.project_id if configuration else None,
    )


@router.put("/config", response_model=AndroidStatus)
def configure(
    data: FirebaseInput,
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> AndroidStatus:
    client = save_configuration(settings.storage_path, data)
    return AndroidStatus(configured=True, project_id=client.project_id)


@router.post("/pairings", response_model=PairingResponse, status_code=201)
def begin(
    data: PairingRequest,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
    settings: Settings = Depends(get_settings),
) -> PairingResponse:
    require_configuration(settings)
    return start_pairing(db, current, data.device_id)


@router.post("/prepare", response_model=PairingConfiguration)
def prepare(
    data: TicketInput, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> PairingConfiguration:
    row = pairing(db, data.ticket.get_secret_value())
    return PairingConfiguration(
        client=require_configuration(settings).client, device_id=row.device_id
    )


@router.post("/complete", status_code=204)
def complete(
    data: PairingCompletion,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    finish_pairing(db, data, require_configuration(settings))


@router.put("/token", status_code=204)
def refresh(
    data: TokenInput,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(731492683)"))
    subscription, _ = authenticate_device(db, authorization)
    configuration = require_configuration(settings)
    if subscription.keys.get("project_id") != configuration.client.project_id:
        raise ConflictError("The server changed Firebase projects. Enable notifications again.")
    endpoint = native_endpoint(configuration, data.token.get_secret_value())
    collision = db.scalar(
        select(PushSubscription.id).where(
            PushSubscription.endpoint == endpoint, PushSubscription.id != subscription.id
        )
    )
    if collision:
        raise ConflictError(
            "This phone is paired with another session. Enable notifications again."
        )
    subscription.endpoint = endpoint
    db.commit()


@router.delete("/device", status_code=204)
def disconnect(authorization: str = Header(default=""), db: Session = Depends(get_db)) -> None:
    subscription, _ = authenticate_device(db, authorization)
    db.delete(subscription)
    db.commit()


@router.post("/actions", status_code=204)
def action(
    data: NativeReminderAction,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> None:
    _, session = authenticate_device(db, authorization)
    ReminderService(db).act(
        data.message_id,
        session.user_id,
        ReminderAction(action=data.action, revision=data.revision, minutes=data.minutes),
    )
