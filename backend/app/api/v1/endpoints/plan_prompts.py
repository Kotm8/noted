from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.notifications.android_service import authenticate_device
from app.schedule.prompts.models import PlanPrompt, PlanPromptEvent
from app.schedule.prompts.schemas import PromptAction, PromptEventResponse, PromptResponse
from app.schedule.prompts.service import act_on_prompt, due_prompts, prompt_history

router = APIRouter(tags=["schedule"])


@router.get("/schedule/prompts", response_model=list[PromptResponse])
def pending(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[PlanPrompt]:
    return due_prompts(db, current.user.id)


@router.post("/schedule/prompts/{prompt_id}/actions", response_model=PromptResponse)
def action(
    prompt_id: UUID,
    data: PromptAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> PlanPrompt:
    return act_on_prompt(db, current.user.id, prompt_id, data)


@router.get("/schedule/plans/{plan_id}/prompt-history", response_model=list[PromptEventResponse])
def history(
    plan_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[PlanPromptEvent]:
    return prompt_history(db, current.user.id, plan_id)


@router.get("/notifications/android/plan-prompts", response_model=dict[str, list[PromptResponse]])
def native_pending(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> dict[str, list[PlanPrompt]]:
    _, session = authenticate_device(db, authorization)
    return {"prompts": due_prompts(db, session.user_id)}


@router.get("/notifications/android/activities")
def native_activities(
    authorization: str = Header(default=""), db: Session = Depends(get_db)
) -> dict[str, list[dict[str, str]]]:
    from app.time_tracking.repository import TrackingRepository

    _, session = authenticate_device(db, authorization)
    return {
        "activities": [
            {"id": str(item.id), "name": item.name}
            for item in TrackingRepository(db).activities(session.user_id)
            if not item.archived
        ]
    }


@router.post("/notifications/android/plan-prompts/{prompt_id}/actions", status_code=204)
def native_action(
    prompt_id: UUID,
    data: PromptAction,
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> None:
    _, session = authenticate_device(db, authorization)
    act_on_prompt(db, session.user_id, prompt_id, data)
