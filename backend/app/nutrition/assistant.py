"""What the shared assistant can see of Nutrition, and how its meal proposals are saved."""

from datetime import timedelta
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ValidationError
from app.nutrition.models import Meal, MealPhoto, NutritionProfile
from app.nutrition.schemas import MealFields, MealUpdate
from app.nutrition.service import NutritionService

if TYPE_CHECKING:
    from app.ai.assistant.schemas import AssistantApply

CONTEXT_DAYS = 7
MAX_CONTEXT_MEALS = 80


def nutrition_context(db: Session, owner_id: UUID) -> dict[str, Any]:
    if db.get(NutritionProfile, owner_id) is None:
        return {"set_up": False}
    service = NutritionService(db)
    today = service.today(owner_id)
    target = service.target_on(owner_id, today)
    meals = list(
        db.scalars(
            select(Meal)
            .where(Meal.owner_id == owner_id, Meal.day >= today - timedelta(days=CONTEXT_DAYS))
            .order_by(Meal.day.desc(), Meal.minute.desc())
            .limit(MAX_CONTEXT_MEALS)
        )
    )
    pictured = set(
        db.scalars(
            select(MealPhoto.meal_id).where(MealPhoto.meal_id.in_([meal.id for meal in meals]))
        )
    )
    return {
        "set_up": True,
        "today": today.isoformat(),
        "target": (
            {
                "kcal": target.kcal,
                "protein": target.protein,
                "carbs": target.carbs,
                "fat": target.fat,
            }
            if target
            else None
        ),
        "meals": [
            {
                "id": str(meal.id),
                "revision": meal.revision,
                "day": meal.day.isoformat(),
                "minute": meal.minute,
                "slot": meal.slot,
                "name": meal.name,
                "items": meal.items,
                "has_photo": meal.id in pictured,
            }
            for meal in meals
        ],
        "saved_meals": [
            {"name": item.name, "items": item.items} for item in service.saved(owner_id)[:40]
        ],
    }


def apply_meals(
    db: Session, owner_id: UUID, data: "AssistantApply", result: dict[str, list[str]]
) -> None:
    if not data.meals:
        return
    service = NutritionService(db)
    today = service.today(owner_id)
    for change in data.meals:
        fields = change.fields
        if fields.day > today + timedelta(days=1):
            raise ValidationError("Meals can't be logged for days that haven't happened yet.")
        values = {**fields.model_dump(), "source": "ai"}
        if change.id is None:
            meal = service.add_meal(owner_id, MealFields(**values, photo_ids=change.photo_ids))
        else:
            current = service.response(service._meal(owner_id, change.id))
            kept = list(dict.fromkeys([*current.photo_ids, *change.photo_ids]))[:4]
            meal = service.edit_meal(
                owner_id,
                change.id,
                MealUpdate(
                    **values,
                    photo_ids=kept,
                    saved_meal_id=current.saved_meal_id,
                    revision=change.revision,
                ),
            )
        result["meals"].append(str(meal.id))
        if change.picture and not service.response(meal).photo_ids:
            result["pictures"].append(str(meal.id))
