import json
from collections.abc import AsyncIterator
from uuid import UUID

from anyio import to_thread
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic_ai.messages import UserContent
from sqlalchemy.orm import Session

from app.ai.assistant import chats
from app.ai.assistant.models import AiMemory, AssistantChat, AssistantTurn
from app.ai.assistant.schemas import (
    AssistantApply,
    AssistantRequest,
    ChatSummary,
    ChatTurn,
    MemoryResponse,
)
from app.ai.assistant.service import apply_changes, prepare_assistant
from app.ai.runs import Prepared, RunService
from app.ai.streaming import event
from app.auth.services.sessions import AuthenticatedSession
from app.core.config import Settings
from app.core.errors import NotFoundError, ValidationError
from app.dependencies.auth import get_current_session
from app.dependencies.config import get_settings
from app.dependencies.database import get_db
from app.nutrition.models import MealPhoto
from app.nutrition.photos import photo_content

router = APIRouter(prefix="/ai/assistant", tags=["AI assistant"])
memory_router = APIRouter(prefix="/ai/memories", tags=["AI assistant"])


@router.post("")
async def ask(
    data: AssistantRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    current: AuthenticatedSession = Depends(get_current_session),
) -> StreamingResponse:
    engine = request.app.state.engine

    def prepare() -> Prepared:
        with Session(engine) as db:
            return prepare_assistant(db, current.user.id, data)

    prepared = await to_thread.run_sync(prepare)
    pictures: list[UserContent] = [
        await photo_content(request.app.state.storage, MealPhoto(id=photo_id, storage_key=key))
        for photo_id, key in prepared.photo_keys
    ]
    service = RunService(engine, settings.storage_path)
    chat_id = prepared.chat_id
    assert chat_id is not None

    async def stream() -> AsyncIterator[str]:
        """Tells the app which chat this is, and keeps the finished reply in it."""
        yield event("chat", chat_id=str(chat_id))
        async for line in service.stream(prepared, pictures):
            item = json.loads(line)
            if item.get("type") == "done" and isinstance(item.get("output"), dict):
                try:
                    item["output"] = await to_thread.run_sync(
                        chats.finish_reply,
                        engine,
                        current.user.id,
                        prepared.numbered,
                        prepared.reply_to,
                        item["output"],
                    )
                except (NotFoundError, ValidationError) as error:
                    item["output"] = {**item["output"], "reply_error": str(error)}
                turn_id = await to_thread.run_sync(
                    chats.record_reply, engine, chat_id, current.user.id, item
                )
                yield event("turn", turn_id=str(turn_id))
                yield json.dumps(item, ensure_ascii=False, default=str) + "\n"
                continue
            yield line

    return StreamingResponse(
        stream(),
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


@router.get("/chats", response_model=list[ChatSummary])
def list_chats(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[AssistantChat]:
    return chats.chats(db, current.user.id)


@router.get("/chats/{chat_id}", response_model=list[ChatTurn])
def chat_turns(
    chat_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> list[AssistantTurn]:
    return chats.turns(db, chats.chat_for(db, current.user.id, chat_id).id)


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(
    chat_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    chats.delete_chat(db, current.user.id, chat_id)


@memory_router.get("", response_model=list[MemoryResponse])
def list_memories(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> list[AiMemory]:
    return chats.memories(db, current.user.id)


@memory_router.delete("/{memory_id}", status_code=204)
def forget_memory(
    memory_id: UUID,
    db: Session = Depends(get_db),
    current: AuthenticatedSession = Depends(get_current_session),
) -> None:
    chats.forget(db, current.user.id, memory_id)


@memory_router.delete("", status_code=204)
def forget_everything(
    db: Session = Depends(get_db), current: AuthenticatedSession = Depends(get_current_session)
) -> None:
    chats.forget(db, current.user.id)
