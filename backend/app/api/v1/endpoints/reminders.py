from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.reminders.models import Reminder
from app.reminders.schemas import ReminderAction, ReminderResponse, ReminderSchedule
from app.reminders.service import ReminderService

router = APIRouter(tags=["reminders"])


@router.put("/messages/{message_id}/reminder", response_model=ReminderResponse)
def reschedule(
    message_id: UUID,
    data: ReminderSchedule,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Reminder:
    return ReminderService(db).schedule(message_id, current.user.id, data)


@router.post("/messages/{message_id}/reminder/actions", response_model=ReminderResponse)
def act(
    message_id: UUID,
    data: ReminderAction,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Reminder:
    return ReminderService(db).act(message_id, current.user.id, data)
