from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession, SessionService
from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.notifications.android_schemas import PairingResponse
from app.notifications.android_service import native_endpoint
from app.notifications.models import PushSubscription
from app.reminders.schemas import ReminderAction, ReminderResponse
from app.reminders.service import ReminderService
from app.schedule.prompts.models import PlanPrompt
from app.schedule.prompts.schemas import PromptAction, PromptResponse
from app.schedule.prompts.service import act_on_prompt
from app.time_tracking.schemas import TrackerAction, TrackerResponse
from app.time_tracking.service import TrackingService
from app.wear import service
from app.wear.models import WatchDevice
from app.wear.schemas import (
    WatchCredentials,
    WatchPairingInput,
    WatchSettings,
    WatchSnapshot,
    WatchTestResult,
    WatchToken,
)

router = APIRouter(prefix="/wear", tags=["watch"])


def watch_session(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> AuthenticatedSession:
    return service.authenticate(db, authorization)


@router.post("/pairings", response_model=PairingResponse, status_code=201)
def begin(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> PairingResponse:
    return service.begin_pairing(db, current)


@router.post("/connect", response_model=WatchCredentials)
def connect(
    data: WatchPairingInput,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> WatchCredentials:
    response.headers["Cache-Control"] = "no-store"
    return service.finish_pairing(db, data, settings)


@router.get("/settings", response_model=WatchSettings)
def read_settings(current: AuthenticatedSession = Depends(get_current_session)) -> WatchSettings:
    return WatchSettings.model_validate(current.user.watch_preferences or {})


@router.put("/settings", response_model=WatchSettings)
def update_settings(
    data: WatchSettings,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> WatchSettings:
    current.user.watch_preferences = data.model_dump(mode="json")
    db.commit()
    return data


@router.get("/snapshot", response_model=WatchSnapshot)
def snapshot(
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
    settings: Settings = Depends(get_settings),
) -> WatchSnapshot:
    return service.snapshot(db, current, settings)


@router.post("/tracker", response_model=TrackerResponse)
def tracker(
    data: TrackerAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
) -> TrackerResponse:
    return TrackingService(db).act(current.user.id, data)


@router.get("/prompts/{prompt_id}", response_model=PromptResponse)
def read_prompt(
    prompt_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
) -> PromptResponse:
    """The snapshot lists only waiting prompts. A watch opening an older notification
    reads the prompt's status here to say why it no longer applies."""
    item = db.scalar(
        select(PlanPrompt).where(PlanPrompt.owner_id == current.user.id, PlanPrompt.id == prompt_id)
    )
    if item is None:
        raise NotFoundError("Task prompt not found")
    return PromptResponse.model_validate(item)


@router.post("/prompts/{prompt_id}/actions", response_model=PromptResponse)
def prompt(
    prompt_id: UUID,
    data: PromptAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
) -> PromptResponse:
    return PromptResponse.model_validate(act_on_prompt(db, current.user.id, prompt_id, data))


@router.post("/reminders/{message_id}/actions", response_model=ReminderResponse)
def reminder(
    message_id: UUID,
    data: ReminderAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
) -> ReminderResponse:
    return ReminderResponse.model_validate(
        ReminderService(db).act(message_id, current.user.id, data)
    )


@router.put("/push", status_code=204)
def push(
    data: WatchToken,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
    settings: Settings = Depends(get_settings),
) -> None:
    from app.api.v1.endpoints.android_notifications import require_configuration

    configuration = require_configuration(settings)
    device = db.scalar(select(WatchDevice).where(WatchDevice.session_id == current.session.id))
    assert device is not None
    endpoint = native_endpoint(configuration, data.token.get_secret_value())
    collision = db.scalar(
        select(PushSubscription.id).where(
            PushSubscription.endpoint == endpoint, PushSubscription.session_id != current.session.id
        )
    )
    if collision:
        raise ConflictError("This notification token belongs to another device session.")
    subscription = db.scalar(
        select(PushSubscription).where(PushSubscription.session_id == current.session.id)
    )
    if subscription is None:
        subscription = PushSubscription(
            session_id=current.session.id,
            device_id=device.id,
            kind="mobile",
            endpoint=endpoint,
            keys={"project_id": configuration.client.project_id},
        )
        db.add(subscription)
    else:
        subscription.endpoint = endpoint
    db.commit()


@router.post("/push/test", response_model=WatchTestResult)
def test_push(
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(watch_session),
    settings: Settings = Depends(get_settings),
) -> WatchTestResult:
    return service.send_test(db, current, settings)


@router.delete("/device", status_code=204)
def disconnect(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(watch_session)
) -> None:
    SessionService(db).revoke(current.session)
