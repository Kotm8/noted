import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import utc_now
from app.db.base import Base


class NutritionProfile(Base):
    """What the target is worked out from. One per owner."""

    __tablename__ = "nutrition_profiles"
    __table_args__ = (
        CheckConstraint("sex IN ('male', 'female', 'unspecified')", name="ck_nutrition_sex"),
        CheckConstraint(
            "activity IN ('sedentary', 'light', 'moderate', 'very', 'athlete')",
            name="ck_nutrition_activity",
        ),
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Age is kept with the day it was given, so it grows by itself.
    age: Mapped[int]
    age_given_on: Mapped[date] = mapped_column(Date)
    sex: Mapped[str] = mapped_column(String(12))
    height_cm: Mapped[float]
    weight_kg: Mapped[float]
    activity: Mapped[str] = mapped_column(String(12))
    goal: Mapped[str] = mapped_column(String(300), default="")
    pace: Mapped[str] = mapped_column(String(10), default="standard")
    pregnant: Mapped[bool] = mapped_column(default=False)
    read_training: Mapped[bool] = mapped_column(default=True)
    revision: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class NutritionTarget(Base):
    """An accepted target, in force from `starts_on` until the next one."""

    __tablename__ = "nutrition_targets"
    __table_args__ = (Index("uq_nutrition_target_day", "owner_id", "starts_on", unique=True),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    starts_on: Mapped[date] = mapped_column(Date)
    resting: Mapped[int]
    maintenance: Mapped[int]
    kcal: Mapped[int]
    protein: Mapped[int]
    carbs: Mapped[int]
    fat: Mapped[int]
    explanation: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list[dict[str, str]]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Meal(Base):
    __tablename__ = "meals"
    __table_args__ = (
        CheckConstraint("slot IN ('Breakfast', 'Lunch', 'Dinner', 'Snack')", name="ck_meal_slot"),
        CheckConstraint("minute BETWEEN 0 AND 1439", name="ck_meal_minute"),
        Index("ix_meals_owner_day", "owner_id", "day"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    minute: Mapped[int]
    slot: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(80))
    # Items are always edited together with their meal, so they live on it.
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(8), default="manual")
    saved_meal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("saved_meals.id", ondelete="SET NULL")
    )
    revision: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SavedMeal(Base):
    __tablename__ = "saved_meals"
    __table_args__ = (Index("ix_saved_meals_owner", "owner_id"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    uses: Mapped[int] = mapped_column(default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(default=1)


class WeighIn(Base):
    __tablename__ = "weigh_ins"
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    weight_kg: Mapped[float]


class MealPhoto(Base):
    """A WebP copy of a meal photo; photos never saved to a meal are removed after a day."""

    __tablename__ = "meal_photos"
    __table_args__ = (Index("ix_meal_photos_owner", "owner_id", "created_at"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    meal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("meals.id", ondelete="SET NULL"))
    storage_key: Mapped[str] = mapped_column(String(96))
    size: Mapped[int]
    width: Mapped[int]
    height: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
