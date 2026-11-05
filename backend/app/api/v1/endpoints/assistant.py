from anyio import to_thread
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.ai.assistant.schemas import AssistantApply, AssistantRequest
from app.ai.assistant.service import apply_changes, prepare_assistant
from app.ai.runs import Prepared, RunService
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db

router = APIRouter(prefix="/ai/assistant", tags=["AI assistant"])


@router.post("")
async def ask(
    data: AssistantRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    def prepare() -> Prepared:
        with Session(request.app.state.engine) as db:
            return prepare_assistant(db, current.user.id, data)

    prepared = await to_thread.run_sync(prepare)
    service = RunService(request.app.state.engine, settings.storage_path)
    return StreamingResponse(
        service.stream(prepared),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/apply")
def apply(
    data: AssistantApply,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> dict[str, list[str]]:
    return apply_changes(db, current.user.id, data)
