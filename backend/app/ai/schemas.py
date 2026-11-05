import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Kind = Literal["rewrite", "reply", "draft", "answer"]
Place = Literal["messages", "journals", "documents", "composer"]
Thinking = Literal["low", "medium", "high", "xhigh"]
DEFAULT_MODEL = "gpt-6.1-sol"


class AiPreferences(BaseModel):
    model: str = Field(default=DEFAULT_MODEL, min_length=1, max_length=80)
    thinking: Thinking = "medium"
    standing_note: str = Field(default="", max_length=2000)
    calendar_note: str = Field(default="", max_length=2000)
    web_search: bool = False
    keep_history: bool = True


def _messages_only() -> list[Place]:
    return ["messages"]


class PromptInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    instructions: str = Field(min_length=1, max_length=4000)
    kind: Kind
    places: list[Place] = Field(default_factory=_messages_only, max_length=4)
    sees: Literal["selection", "channel_today"] = "selection"
    model: str | None = Field(default=None, max_length=80)


class PromptUpdate(PromptInput):
    revision: int = Field(ge=1)


class PromptResponse(PromptInput):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    position: int
    revision: int


class PromptOrder(BaseModel):
    ids: list[uuid.UUID] = Field(max_length=200)


class ConversationTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=40000)


class RunInput(BaseModel):
    """A saved prompt by id, or a one-off prompt with its own instructions and kind."""

    prompt_id: uuid.UUID | None = None
    instructions: str | None = Field(default=None, max_length=4000)
    kind: Kind = "rewrite"
    place: Place = "messages"
    channel_id: uuid.UUID | None = None
    message_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    text: str | None = Field(default=None, max_length=250000)
    entry_ids: list[uuid.UUID] = Field(default_factory=list, max_length=60)
    conversation_id: uuid.UUID | None = None
    history: list[ConversationTurn] = Field(default_factory=list, max_length=20)
    where: str | None = Field(default=None, max_length=120)


class RunOutcome(BaseModel):
    outcome: Literal["applied", "cancelled", "saved", "reply", "draft"]


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    prompt_name: str
    instructions: str
    kind: str
    place: str
    channel_id: uuid.UUID | None
    conversation_id: uuid.UUID | None
    where: str
    model: str
    input: list[dict[str, Any]]
    output: Any
    outcome: str
    error: str | None
    usage: dict[str, Any] | None


class ConversationSummary(BaseModel):
    id: uuid.UUID
    question: str
    turns: int
    updated_at: datetime


class AuthInput(BaseModel):
    auth_json: str = Field(min_length=2, max_length=20000)


class SignInFinish(BaseModel):
    address: str = Field(min_length=10, max_length=4000)
