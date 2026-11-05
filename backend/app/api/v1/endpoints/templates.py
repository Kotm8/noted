from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth.services.sessions import AuthenticatedSession
from app.dependencies.auth import get_current_session
from app.dependencies.database import get_db
from app.templates.models import DayTemplate, NoteTemplate
from app.templates.schemas import (
    AppliedDay,
    ApplyDay,
    CaptureDay,
    DayTemplateFields,
    DayTemplateResponse,
    DayTemplateUpdate,
    NoteTemplateFields,
    NoteTemplateResponse,
    NoteTemplateUpdate,
)
from app.templates.service import TemplateService

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("/notes", response_model=list[NoteTemplateResponse])
def notes(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[NoteTemplate]:
    return TemplateService(db).repository.list(NoteTemplate, current.user.id)


@router.post("/notes", response_model=NoteTemplateResponse, status_code=201)
def create_note(
    data: NoteTemplateFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> NoteTemplate:
    return TemplateService(db).save_note(current.user.id, data)


@router.put("/notes/{identifier}", response_model=NoteTemplateResponse)
def update_note(
    identifier: UUID,
    data: NoteTemplateUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> NoteTemplate:
    return TemplateService(db).save_note(current.user.id, data, identifier, data.revision)


@router.delete("/notes/{identifier}", status_code=204)
def delete_note(
    identifier: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Response:
    TemplateService(db).remove(NoteTemplate, current.user.id, identifier, revision)
    return Response(status_code=204)


@router.get("/days", response_model=list[DayTemplateResponse])
def days(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[DayTemplate]:
    return TemplateService(db).repository.list(DayTemplate, current.user.id)


@router.post("/days", response_model=DayTemplateResponse, status_code=201)
def create_day(
    data: DayTemplateFields,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DayTemplate:
    return TemplateService(db).save_day(current.user.id, data)


@router.post("/days/capture", response_model=DayTemplateResponse, status_code=201)
def capture_day(
    data: CaptureDay,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DayTemplate:
    return TemplateService(db).capture(current.user.id, data)


@router.put("/days/{identifier}", response_model=DayTemplateResponse)
def update_day(
    identifier: UUID,
    data: DayTemplateUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> DayTemplate:
    return TemplateService(db).save_day(current.user.id, data, identifier, data.revision)


@router.delete("/days/{identifier}", status_code=204)
def delete_day(
    identifier: UUID,
    revision: int = Query(ge=1),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> Response:
    TemplateService(db).remove(DayTemplate, current.user.id, identifier, revision)
    return Response(status_code=204)


@router.post("/days/{identifier}/apply", response_model=AppliedDay)
def apply_day(
    identifier: UUID,
    data: ApplyDay,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> AppliedDay:
    return TemplateService(db).apply(current.user.id, identifier, data)
