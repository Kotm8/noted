"""Nutrition in portable backups: profile, targets, meals with their photos, saved meals, weight."""

from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import ValidationError
from app.nutrition.models import (
    Meal,
    MealPhoto,
    NutritionProfile,
    NutritionTarget,
    SavedMeal,
    WeighIn,
)
from app.nutrition.service import MAX_SAVED_MEALS

NUTRITION_VERSION = 11


def nutrition_queries(owner_id: UUID) -> dict[str, Any]:
    meals = select(Meal.id).where(Meal.owner_id == owner_id)
    return {
        "nutrition_profiles": select(NutritionProfile.__table__).where(
            NutritionProfile.owner_id == owner_id
        ),
        "nutrition_targets": select(NutritionTarget.__table__).where(
            NutritionTarget.owner_id == owner_id
        ),
        "saved_meals": select(SavedMeal.__table__).where(SavedMeal.owner_id == owner_id),
        "meals": select(Meal.__table__).where(Meal.owner_id == owner_id),
        "meal_photos": select(MealPhoto.__table__)
        .where(MealPhoto.meal_id.in_(meals))
        .order_by(MealPhoto.created_at),
        "weigh_ins": select(WeighIn.__table__).where(WeighIn.owner_id == owner_id),
    }


async def nutrition_document(
    rows: dict[str, list[dict[str, Any]]],
    add_file: Callable[[str, int], Awaitable[dict[str, Any]]],
) -> dict[str, Any] | None:
    if not any(
        rows[name]
        for name in ("nutrition_profiles", "nutrition_targets", "meals", "saved_meals", "weigh_ins")
    ):
        return None
    photos: dict[UUID, list[dict[str, Any]]] = {}
    for photo in rows["meal_photos"]:
        photos.setdefault(photo["meal_id"], []).append(
            await add_file(photo["storage_key"], photo["size"])
        )
    profile = rows["nutrition_profiles"][0] if rows["nutrition_profiles"] else None
    profile_keys = (
        "age",
        "age_given_on",
        "sex",
        "height_cm",
        "weight_kg",
        "activity",
        "goal",
        "pace",
        "pregnant",
        "read_training",
    )
    return {
        "nutrition_profile": {key: profile[key] for key in profile_keys} if profile else None,
        "nutrition_targets": [
            {
                key: row[key]
                for key in (
                    "starts_on",
                    "resting",
                    "maintenance",
                    "kcal",
                    "protein",
                    "carbs",
                    "fat",
                    "explanation",
                    "sources",
                )
            }
            for row in rows["nutrition_targets"]
        ],
        "saved_meals": [
            {key: row[key] for key in ("id", "name", "items", "uses")}
            for row in rows["saved_meals"]
        ],
        "meals": [
            {
                **{
                    key: row[key]
                    for key in (
                        "id",
                        "day",
                        "minute",
                        "slot",
                        "name",
                        "items",
                        "source",
                        "saved_meal_id",
                        "created_at",
                    )
                },
                "photos": photos.get(row["id"], []),
            }
            for row in rows["meals"]
        ],
        "weigh_ins": [{key: row[key] for key in ("day", "weight_kg")} for row in rows["weigh_ins"]],
    }


def validate_nutrition(data: Any) -> None:
    present = (
        data.nutrition_profile
        or data.nutrition_targets
        or data.meals
        or data.saved_meals
        or data.weigh_ins
    )
    if not present:
        return
    if data.version < NUTRITION_VERSION:
        raise ValidationError("Nutrition requires a version 11 backup.")
    if len(data.saved_meals) > MAX_SAVED_MEALS:
        raise ValidationError(f"Keep up to {MAX_SAVED_MEALS} saved meals.")
    saved = {item.id for item in data.saved_meals}
    if any(item.saved_meal_id and item.saved_meal_id not in saved for item in data.meals):
        raise ValidationError("A meal references an unknown saved meal.")
    for group in (
        [item.id for item in data.saved_meals],
        [item.id for item in data.meals],
        [item.starts_on for item in data.nutrition_targets],
        [item.day for item in data.weigh_ins],
    ):
        if len(set(group)) != len(group):
            raise ValidationError("The backup contains duplicate Nutrition records.")
    if any(len(item.photos) > 4 for item in data.meals):
        raise ValidationError("A meal can have up to four photos.")


def restore_nutrition(
    db: Session, owner_id: UUID, data: Any, keys: dict[str, str], replace: bool
) -> None:
    """Merges by default: existing targets and weigh-ins on the same day are kept."""
    if not (
        data.nutrition_profile
        or data.nutrition_targets
        or data.meals
        or data.saved_meals
        or data.weigh_ins
    ):
        return
    if replace:
        for model in (Meal, SavedMeal, NutritionTarget, WeighIn, NutritionProfile):
            db.execute(delete(model).where(model.owner_id == owner_id))
        db.flush()
    if data.nutrition_profile and (replace or db.get(NutritionProfile, owner_id) is None):
        existing = db.get(NutritionProfile, owner_id)
        if existing:
            db.delete(existing)
            db.flush()
        db.add(NutritionProfile(owner_id=owner_id, **data.nutrition_profile.model_dump()))
    taken_days: set[date] = set(
        db.scalars(select(NutritionTarget.starts_on).where(NutritionTarget.owner_id == owner_id))
    )
    for target in data.nutrition_targets:
        if target.starts_on not in taken_days:
            db.add(
                NutritionTarget(
                    owner_id=owner_id,
                    **target.model_dump(exclude={"sources"}),
                    sources=[item.model_dump() for item in target.sources],
                )
            )
    names = {
        name.lower()
        for name in db.scalars(select(SavedMeal.name).where(SavedMeal.owner_id == owner_id))
    }
    if len(names) + len(data.saved_meals) > MAX_SAVED_MEALS:
        raise ValidationError("Import exceeds the saved meal limit. Use Replace instead.")
    saved_ids: dict[UUID, UUID] = {}
    for item in data.saved_meals:
        name = item.name
        suffix = 2
        while name.lower() in names:
            name = f"{item.name[:74]} ({suffix})"
            suffix += 1
        names.add(name.lower())
        saved_ids[item.id] = uuid4()
        db.add(
            SavedMeal(
                id=saved_ids[item.id],
                owner_id=owner_id,
                name=name,
                items=[entry.model_dump() for entry in item.items],
                uses=item.uses,
            )
        )
    db.flush()
    for item in data.meals:
        meal = Meal(
            id=uuid4(),
            owner_id=owner_id,
            **item.model_dump(exclude={"id", "items", "saved_meal_id", "photos"}),
            items=[entry.model_dump() for entry in item.items],
            saved_meal_id=saved_ids.get(item.saved_meal_id) if item.saved_meal_id else None,
        )
        db.add(meal)
        db.flush()
        for blob in item.photos:
            db.add(
                MealPhoto(
                    owner_id=owner_id,
                    meal_id=meal.id,
                    storage_key=keys[blob.path],
                    size=blob.size,
                    width=0,
                    height=0,
                )
            )
    days = set(db.scalars(select(WeighIn.day).where(WeighIn.owner_id == owner_id)))
    for weigh in data.weigh_ins:
        if weigh.day not in days:
            db.add(WeighIn(owner_id=owner_id, day=weigh.day, weight_kg=weigh.weight_kg))
