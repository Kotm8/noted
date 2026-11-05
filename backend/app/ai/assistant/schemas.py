from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

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

    @model_validator(mode="after")
    def target(self) -> "MealChange":
        if (self.id is None) != (self.revision is None):
            raise ValueError("An edit needs the meal ID and current revision")
        return self


class AssistantProposal(BaseModel):
    explanation: str = Field(max_length=8000)
    habits: list[HabitChange] = Field(default_factory=list, max_length=30)
    plans: list[PlanChange] = Field(default_factory=list, max_length=30)
    meals: list[MealChange] = Field(default_factory=list, max_length=20)


class AssistantRequest(CalendarScope):
    instructions: str = Field(min_length=1, max_length=4000)
    history: list[ConversationTurn] = Field(default_factory=list, max_length=20)


class AssistantApply(AssistantProposal, CalendarScope):
    request_id: UUID
