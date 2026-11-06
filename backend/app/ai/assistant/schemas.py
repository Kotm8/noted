from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.ai.calendar.schemas import CalendarScope
from app.ai.schemas import ConversationTurn
from app.habits.schemas import HabitFields
from app.nutrition.schemas import MealItem, Slot
from app.schedule.schemas import PlanCreate


class HabitChange(BaseModel):
    id: UUID | None = None
    revision: int | None = Field(default=None, ge=1)
    fields: HabitFields

    @model_validator(mode="after")
    def target(self) -> "HabitChange":
        if (self.id is None) != (self.revision is None):
            raise ValueError("An edit needs the habit ID and current revision")
        return self


class PlanChange(BaseModel):
    id: UUID | None = None
    revision: int | None = Field(default=None, ge=1)
    scope: Literal["series", "occurrence"] = "series"
    occurrence_date: date | None = None
    fields: PlanCreate

    @model_validator(mode="after")
    def target(self) -> "PlanChange":
        if (self.id is None) != (self.revision is None):
            raise ValueError("An edit needs the plan ID and current revision")
        if self.scope == "occurrence" and (self.id is None or self.occurrence_date is None):
            raise ValueError("Choose an existing plan occurrence")
        return self


class MealChangeFields(BaseModel):
    day: date
    minute: int = Field(ge=0, le=1439, description="Local minutes after midnight")
    slot: Slot
    name: str = Field(min_length=1, max_length=80)
    items: list[MealItem] = Field(min_length=1, max_length=40)


class MealChange(BaseModel):
    id: UUID | None = None
    revision: int | None = Field(default=None, ge=1)
    fields: MealChangeFields
    picture: bool = Field(
        default=False, description="Make a picture of the meal after it's saved, if it has none"
    )
    photo_ids: list[UUID] = Field(
        default_factory=list,
        max_length=4,
        description="IDs of pictures the owner attached in this chat that show this meal",
    )

    @model_validator(mode="after")
    def target(self) -> "MealChange":
        if (self.id is None) != (self.revision is None):
            raise ValueError("An edit needs the meal ID and current revision")
        return self


class MessageRewrite(BaseModel):
    number: int = Field(description="The attached message's number")
    text: str = Field(max_length=40000, description="Its complete new text, Markdown kept")


class MessagePost(BaseModel):
    channel_id: UUID
    text: str = Field(min_length=1, max_length=40000)

    @field_validator("text")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write something before posting")
        return value


class ItemDeletion(BaseModel):
    kind: Literal["message", "journal", "plan"]
    id: UUID
    revision: int | None = Field(default=None, ge=1)
    scope: Literal["series", "occurrence"] | None = None
    occurrence_date: date | None = None


class AppliedPost(MessagePost):
    key: str = Field(pattern=r"^post-\d{1,3}$")


class AppliedDeletion(ItemDeletion):
    key: str = Field(pattern=r"^delete-\d{1,3}$")


class AssistantActions(BaseModel):
    request_id: UUID
    turn_id: UUID | None = None
    posts: list[AppliedPost] = Field(default_factory=list, max_length=20)
    deletions: list[AppliedDeletion] = Field(default_factory=list, max_length=30)
    confirmed: bool = False


class AssistantProposal(BaseModel):
    explanation: str = Field(
        max_length=8000,
        description="Your answer to the owner, in Markdown. Write this first.",
    )
    habits: list[HabitChange] = Field(default_factory=list, max_length=30)
    plans: list[PlanChange] = Field(default_factory=list, max_length=30)
    meals: list[MealChange] = Field(default_factory=list, max_length=20)
    posts: list[MessagePost] = Field(default_factory=list, max_length=20)
    deletions: list[ItemDeletion] = Field(default_factory=list, max_length=30)
    rewrites: list[MessageRewrite] = Field(
        default_factory=list,
        max_length=100,
        description="New text for the attached messages to edit; only those that change",
    )
    reply: str | None = Field(
        default=None,
        max_length=40000,
        description=(
            "A reply to post in the attached message's thread, when the owner asks for one or "
            "asks from inside a thread. It's posted as soon as you finish."
        ),
    )
    draft: str | None = Field(
        default=None,
        max_length=40000,
        description="A message for the owner to edit and send themselves, when they ask for one",
    )


class AssistantContext(BaseModel):
    """Messages the owner attached by asking from them, or from inside their thread."""

    channel_id: UUID
    message_ids: list[UUID] = Field(min_length=1, max_length=100)
    thread_root_id: UUID | None = None
    prompt_id: UUID | None = None


class AssistantRequest(CalendarScope):
    instructions: str = Field(default="", max_length=4000)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=20)
    chat_id: UUID | None = None
    photo_ids: list[UUID] = Field(default_factory=list, max_length=4)
    context: AssistantContext | None = None

    @model_validator(mode="after")
    def asked(self) -> "AssistantRequest":
        if not self.instructions.strip() and not (self.context and self.context.prompt_id):
            raise ValueError("Write what you want the assistant to do")
        return self


class AssistantApply(AssistantProposal, CalendarScope):
    request_id: UUID
    turn_id: UUID | None = None


class ChatSummary(BaseModel):
    id: UUID
    title: str
    updated_at: datetime


class ChatTurn(BaseModel):
    id: UUID
    role: Literal["user", "assistant"]
    content: str
    proposal: dict[str, Any] | None
    sources: list[dict[str, Any]]
    photo_ids: list[UUID]
    attached: dict[str, Any] | None = None
    applied: bool
    created_at: datetime


class MemoryResponse(BaseModel):
    id: UUID
    text: str
    created_at: datetime
