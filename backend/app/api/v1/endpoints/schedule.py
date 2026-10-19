from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.schedule.board import schedule_board
from app.schedule.models import SchedulePlan
from app.schedule.schemas import PlanCreate, PlanResponse, PlanUpdate, ScheduleBoard
from app.schedule.service import ScheduleService

router = APIRouter(prefix="/schedule", tags=["schedule"])


@router.get("", response_model=ScheduleBoard)
def board(
    start: datetime,
    end: datetime,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> ScheduleBoard:
    return schedule_board(db, current.user.id, start, end)


@router.post("/plans", response_model=PlanResponse, status_code=201)
def create(
    data: PlanCreate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SchedulePlan:
    return ScheduleService(db).create(current.user.id, data)


@router.get("/plans/{plan_id}", response_model=PlanResponse)
def get(
    plan_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SchedulePlan:
    return ScheduleService(db).repository.plan(current.user.id, plan_id)


@router.put("/plans/{plan_id}", response_model=PlanResponse)
def update(
    plan_id: UUID,
    data: PlanUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SchedulePlan:
    return ScheduleService(db).update(current.user.id, plan_id, data)


@router.delete("/plans/{plan_id}", response_model=PlanResponse)
def remove(
    plan_id: UUID,
    revision: int = Query(ge=1),
    occurrence_date: date | None = None,
    reset: bool = False,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> SchedulePlan:
    return ScheduleService(db).remove(current.user.id, plan_id, revision, occurrence_date, reset)
