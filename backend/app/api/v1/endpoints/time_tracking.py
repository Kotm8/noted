from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.core.security import utc_now
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.time_tracking.models import Activity, TimeSession
from app.time_tracking.schemas import (
    ActivityCreate,
    ActivityOrder,
    ActivityResponse,
    ActivityUpdate,
    SessionResponse,
    SessionUpdate,
    TrackerAction,
    TrackerResponse,
    TrackingPreferencesUpdate,
)
from app.time_tracking.service import TrackingService
from app.writing_nudges.models import WritingNudge
from app.writing_nudges.schemas import DismissNudge, NudgeResponse
from app.writing_nudges.service import NudgeService

router = APIRouter(prefix="/time-tracking", tags=["time tracking"])


@router.get("/writing-nudges", response_model=list[NudgeResponse])
def writing_nudges(
    channel_id: UUID | None = None,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[WritingNudge]:
    return NudgeService(db).pending(current.user.id, channel_id)


@router.post("/writing-nudges/{nudge_id}/dismiss", status_code=204)
def dismiss_nudge(
    nudge_id: UUID,
    data: DismissNudge,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    NudgeService(db).dismiss(current.user.id, nudge_id, data.revision, utc_now())


@router.get("/tracker", response_model=TrackerResponse)
def read_tracker(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> TrackerResponse:
    return TrackingService(db).read(current.user.id)


@router.post("/tracker", response_model=TrackerResponse)
def act(
    data: TrackerAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> TrackerResponse:
    return TrackingService(db).act(current.user.id, data)


@router.put("/preferences", response_model=TrackerResponse)
def preferences(
    data: TrackingPreferencesUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> TrackerResponse:
    return TrackingService(db).preferences(current.user.id, data)


@router.get("/activities", response_model=list[ActivityResponse])
def activities(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[Activity]:
    return TrackingService(db).repository.activities(current.user.id)


@router.post("/activities", response_model=ActivityResponse, status_code=201)
def create_activity(
    data: ActivityCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Activity:
    return TrackingService(db).save_activity(current.user.id, data)


@router.put("/activities/order", response_model=list[ActivityResponse])
def reorder(
    data: ActivityOrder,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[Activity]:
    return TrackingService(db).reorder(current.user.id, data)


@router.put("/activities/{activity_id}", response_model=ActivityResponse)
def edit_activity(
    activity_id: UUID,
    data: ActivityUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Activity:
    return TrackingService(db).save_activity(current.user.id, data, activity_id)


@router.put("/sessions/{session_id}", response_model=SessionResponse)
def edit_session(
    session_id: UUID,
    data: SessionUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> TimeSession | None:
    return TrackingService(db).edit_session(current.user.id, session_id, data.revision, data)


@router.delete("/sessions/{session_id}", status_code=204)
def remove_session(
    session_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    TrackingService(db).edit_session(current.user.id, session_id, revision)
