import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Slot = Literal["Breakfast", "Lunch", "Dinner", "Snack"]
Sex = Literal["male", "female", "unspecified"]
ActivityLevel = Literal["sedentary", "light", "moderate", "very", "athlete"]


class MealItem(BaseModel):
    name: str = Field(min_length=1, max_length=80, description="What it is, e.g. 'Roast potatoes'")
    amount: str = Field(
        default="", max_length=40, description="The portion as people say it, e.g. '1 cup · 160 g'"
    )
    grams: float | None = Field(default=None, ge=0, le=5000, description="Weight in grams if known")
    kcal: int = Field(ge=0, le=6000)
    protein: float = Field(default=0, ge=0, le=600, description="Grams of protein")
    carbs: float = Field(default=0, ge=0, le=900, description="Grams of carbohydrate")
    fat: float = Field(default=0, ge=0, le=600, description="Grams of fat")
    confidence: Literal["high", "medium", "low"] = Field(
        default="high", description="How sure the estimate is, from what could be seen or was said"
    )


class MealFields(BaseModel):
    day: date
    minute: int = Field(ge=0, le=1439)
    slot: Slot
    name: str = Field(min_length=1, max_length=80)
    items: list[MealItem] = Field(min_length=1, max_length=40)
    source: Literal["ai", "saved", "manual"] = "manual"
    saved_meal_id: uuid.UUID | None = None
    photo_ids: list[uuid.UUID] = Field(default_factory=list, max_length=4)
    remember: bool = False


class MealUpdate(MealFields):
    revision: int = Field(ge=1)


class MealResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: date
    minute: int
    slot: Slot
    name: str
    items: list[MealItem]
    source: str
    saved_meal_id: uuid.UUID | None
    photo_ids: list[uuid.UUID] = Field(default_factory=list)
    revision: int


class SavedMealFields(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    items: list[MealItem] = Field(min_length=1, max_length=40)


class SavedMealUpdate(SavedMealFields):
    revision: int = Field(ge=1)


class SavedMealResponse(SavedMealFields):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    uses: int
    revision: int


class ProfileFields(BaseModel):
    age: int = Field(ge=13, le=110)
    sex: Sex
    height_cm: float = Field(ge=100, le=250)
    weight_kg: float = Field(ge=30, le=300)
    activity: ActivityLevel
    goal: str = Field(default="", max_length=300)
    pace: Literal["gentle", "standard"] = "standard"
    pregnant: bool = False
    read_training: bool = True


class ProfileResponse(ProfileFields):
    revision: int


class Source(BaseModel):
    url: str = Field(max_length=2000)
    title: str = Field(default="", max_length=300)


MAX_TARGET_SOURCES = 12


class TargetFields(BaseModel):
    kcal: int = Field(ge=800, le=6000)
    protein: int = Field(ge=20, le=400)
    carbs: int = Field(ge=0, le=900)
    fat: int = Field(ge=20, le=300)
    explanation: str = Field(default="", max_length=4000)
    sources: list[Source] = Field(default_factory=list, max_length=MAX_TARGET_SOURCES)


class TargetResponse(TargetFields):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    starts_on: date
    resting: int
    maintenance: int


class LimitsResponse(BaseModel):
    resting: int
    maintenance: int
    lowest: int
    highest: int
    reason: str
    factor: float
    age: int


class WeighInInput(BaseModel):
    day: date
    weight_kg: float = Field(ge=30, le=300)


class WeighInResponse(WeighInInput):
    model_config = ConfigDict(from_attributes=True)


class DaySummary(BaseModel):
    day: date
    kcal: int
    protein: float
    carbs: float
    fat: float
    meals: int
    target: int | None


class NutritionState(BaseModel):
    today: date
    timezone: str
    profile: ProfileResponse | None
    target: TargetResponse | None
    limits: LimitsResponse | None
    saved_meals: list[SavedMealResponse]
    weigh_ins: list[WeighInResponse]


class TrainingActivity(BaseModel):
    name: str
    sessions: int
    days: int
    average_minutes: int


class TrainingSummary(BaseModel):
    activities: list[TrainingActivity]
    habits: list[str]


# What the AI returns. The server checks and clamps these before anyone sees them.


class Choice(BaseModel):
    label: str = Field(max_length=60, description="A short answer, e.g. 'Olive oil and vinegar'")
    item: int = Field(ge=0, description="Index of the item this answer changes")
    kcal: int = Field(ge=0, le=6000, description="That item's calories if this is the answer")
    protein: float = Field(default=0, ge=0, le=600)
    carbs: float = Field(default=0, ge=0, le=900)
    fat: float = Field(default=0, ge=0, le=600)


class Question(BaseModel):
    text: str = Field(max_length=120, description="One short question that most changes the total")
    choices: list[Choice] = Field(min_length=2, max_length=4)


class MealEstimate(BaseModel):
    """The meal as items, with one optional question when the answer changes the total a lot."""

    name: str = Field(max_length=80, description="A short name for the whole meal")
    items: list[MealItem] = Field(default_factory=list, max_length=40)
    saved_meal: str | None = Field(
        default=None, description="Exact name of a saved meal this matches, if it is one"
    )
    question: Question | None = None
    note: str = Field(default="", max_length=300, description="Anything the owner should check")


class TargetProposal(BaseModel):
    """A daily target inside the given limits, with reasons the owner can read."""

    kcal: int = Field(description="Daily calories, inside the given lowest and highest")
    protein: int = Field(description="Grams of protein a day")
    carbs: int = Field(description="Grams of carbohydrate a day")
    fat: int = Field(description="Grams of fat a day")
    activity: ActivityLevel = Field(
        description="The activity level that fits their tracked training best"
    )
    explanation: str = Field(
        max_length=1500,
        description=(
            "Plain words: why this target and pace, and what to expect. Two to four sentences."
        ),
    )


class EstimateInput(BaseModel):
    text: str = Field(default="", max_length=2000)
    photo_ids: list[uuid.UUID] = Field(default_factory=list, max_length=4)
    slot: Slot | None = None


class TargetRequest(BaseModel):
    profile: ProfileFields
