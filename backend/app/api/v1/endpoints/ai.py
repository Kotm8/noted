from typing import Any
from uuid import UUID

from anyio import to_thread
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.ai import connection
from app.ai.calendar.schemas import (
    CalendarApplication,
    CalendarApplicationUpdate,
    CalendarApply,
    CalendarRequest,
)
from app.ai.calendar.service import CalendarService, prepare_calendar
from app.ai.context import InputTooLong
from app.ai.conversations import conversation, conversations
from app.ai.models import AiPrompt, AiRun
from app.ai.prompts import PromptService, preferences
from app.ai.runs import Prepared, RunService, history, run_for
from app.ai.schemas import (
    AiPreferences,
    AuthInput,
    ConversationSummary,
    PromptInput,
    PromptOrder,
    PromptResponse,
    PromptUpdate,
    RunInput,
    RunOutcome,
    RunResponse,
    SignInFinish,
)
from app.ai.streaming import event
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/calendar/runs")
async def calendar_run(
    data: CalendarRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    service = RunService(request.app.state.engine, settings.storage_path)
    owner_id = current.user.id

    def prepare() -> Prepared:
        with Session(service.engine) as db:
            return prepare_calendar(db, owner_id, data)

    try:
        prepared = await to_thread.run_sync(prepare)
    except InputTooLong as error:
        return StreamingResponse(
            iter([event("error", code="too_long", message=error.message)]),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store"},
        )
    return StreamingResponse(
        service.stream(prepared),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/calendar/applications", response_model=CalendarApplication)
def apply_calendar(
    data: CalendarApply,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> CalendarApplication:
    return CalendarService(db).apply(current.user.id, data)


@router.put("/calendar/applications/{request_id}", response_model=CalendarApplication)
def update_calendar_application(
    request_id: UUID,
    data: CalendarApplicationUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> CalendarApplication:
    return CalendarService(db).update(current.user.id, request_id, data)


@router.get("/status")
def status(
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, Any]:
    return connection.status(settings.storage_path)


@router.post("/connection")
def connect(
    data: AuthInput,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, Any]:
    connection.connect(settings.storage_path, connection.parse_auth(data.auth_json))
    return connection.status(settings.storage_path)


@router.post("/connection/sign-in")
def start_sign_in(current: AuthenticatedSession = Depends(get_current_session)) -> dict[str, str]:
    return {"url": connection.start_sign_in()}


@router.post("/connection/sign-in/finish")
async def finish_sign_in(
    data: SignInFinish,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, Any]:
    await connection.finish_sign_in(settings.storage_path, data.address)
    return connection.status(settings.storage_path)


@router.delete("/connection", status_code=204)
def disconnect(
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    connection.disconnect(settings.storage_path)


@router.get("/models")
async def models(
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[dict[str, Any]]:
    return await connection.models(settings.storage_path)


@router.get("/preferences", response_model=AiPreferences)
def get_preferences(current: AuthenticatedSession = Depends(get_current_session)) -> AiPreferences:
    return preferences(current.user)


@router.put("/preferences", response_model=AiPreferences)
def put_preferences(
    data: AiPreferences,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> AiPreferences:
    # Keeps internal markers, such as whether the starter prompts were added.
    current.user.ai_preferences = {**(current.user.ai_preferences or {}), **data.model_dump()}
    db.commit()
    return data


@router.get("/prompts", response_model=list[PromptResponse])
def list_prompts(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[AiPrompt]:
    return PromptService(db).all(current.user.id)


@router.post("/prompts", response_model=PromptResponse, status_code=201)
def create_prompt(
    data: PromptInput,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> AiPrompt:
    return PromptService(db).create(current.user.id, data)


@router.put("/prompts/order", response_model=list[PromptResponse])
def reorder_prompts(
    data: PromptOrder,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[AiPrompt]:
    return PromptService(db).reorder(current.user.id, data.ids)


@router.put("/prompts/{prompt_id}", response_model=PromptResponse)
def update_prompt(
    prompt_id: UUID,
    data: PromptUpdate,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> AiPrompt:
    return PromptService(db).update(current.user.id, prompt_id, data)


@router.delete("/prompts/{prompt_id}", status_code=204)
def delete_prompt(
    prompt_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    PromptService(db).delete(current.user.id, prompt_id)


@router.post("/runs")
async def run(
    data: RunInput,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    """Streams the answer as it's written, as newline-delimited JSON events."""
    service = RunService(request.app.state.engine, settings.storage_path)
    owner_id = current.user.id
    try:
        prepared = await to_thread.run_sync(lambda: service.prepare(owner_id, data))
    except InputTooLong as error:
        return StreamingResponse(
            iter([event("error", code="too_long", message=error.message)]),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store"},
        )
    return StreamingResponse(
        service.stream(prepared),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/conversations", response_model=list[ConversationSummary])
def list_conversations(
    channel_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[ConversationSummary]:
    return conversations(db, current.user.id, channel_id)


@router.get("/conversations/{conversation_id}", response_model=list[RunResponse])
def get_conversation(
    conversation_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[AiRun]:
    return conversation(db, current.user.id, conversation_id)


@router.get("/runs", response_model=list[RunResponse])
def list_runs(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[AiRun]:
    return history(db, current.user.id, limit)


@router.put("/runs/{run_id}", response_model=RunResponse)
def set_outcome(
    run_id: UUID,
    data: RunOutcome,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> AiRun:
    found = run_for(db, current.user.id, run_id)
    found.outcome = data.outcome
    db.commit()
    db.refresh(found)
    return found


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(
    run_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    db.delete(run_for(db, current.user.id, run_id))
    db.commit()


@router.delete("/runs", status_code=204)
def clear_runs(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> None:
    db.execute(delete(AiRun).where(AiRun.owner_id == current.user.id))
    db.commit()
