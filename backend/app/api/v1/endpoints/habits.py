from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.habits.schemas import (
    HabitBoard,
    HabitFields,
    HabitProgress,
    HabitResponse,
    HabitUpdate,
    ProgressInput,
)
from app.habits.service import HabitService

router = APIRouter(prefix="/habits", tags=["habits"])


@router.get("", response_model=HabitBoard)
def board(
    start: date,
    end: date,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> HabitBoard:
    return HabitService(db).board(current.user.id, start, end)


@router.post("", response_model=HabitResponse, status_code=201)
def create(
    data: HabitFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> HabitResponse:
    item = HabitService(db).add(current.user.id, data)
    db.commit()
    return HabitResponse.model_validate(item)


@router.put("/{habit_id}", response_model=HabitResponse)
def edit(
    habit_id: UUID,
    data: HabitUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> HabitResponse:
    item = HabitService(db).edit(current.user.id, habit_id, data)
    db.commit()
    return HabitResponse.model_validate(item)


@router.put("/{habit_id}/progress", response_model=HabitProgress)
def progress(
    habit_id: UUID,
    data: ProgressInput,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> HabitProgress:
    result = HabitService(db).progress(current.user.id, habit_id, data)
    db.commit()
    return result


@router.delete("/{habit_id}", status_code=204)
def remove(
    habit_id: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    HabitService(db).remove(current.user.id, habit_id, revision)
    db.commit()
