"""Energy maths and safety limits. The server works these out; the AI only proposes within them."""

from dataclasses import dataclass
from datetime import date

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "very": 1.725,
    "athlete": 1.9,
}
# Mifflin–St Jeor's sex constants; "unspecified" uses their midpoint.
SEX_CONSTANTS = {"male": 5, "female": -161, "unspecified": -78}
FLOORS = {"male": 1500, "female": 1200, "unspecified": 1350}
MAX_DEFICIT = 0.25
MAX_SURPLUS = 0.15
KCAL_PER_KG = 7700


@dataclass(frozen=True)
class Limits:
    resting: int
    maintenance: int
    lowest: int
    highest: int
    # Why the lowest is where it is, said to the owner when they hit it.
    reason: str


def current_age(age: int, given_on: date, today: date) -> int:
    years = today.year - given_on.year - ((today.month, today.day) < (given_on.month, given_on.day))
    return age + max(0, years)


def resting_energy(sex: str, weight_kg: float, height_cm: float, age: int) -> int:
    return round(10 * weight_kg + 6.25 * height_cm - 5 * age + SEX_CONSTANTS[sex])


def maintenance(resting: int, activity: str) -> int:
    return round(resting * ACTIVITY_FACTORS[activity] / 10) * 10


def bmi(weight_kg: float, height_cm: float) -> float:
    return weight_kg / (height_cm / 100) ** 2


def limits(
    sex: str, weight_kg: float, height_cm: float, age: int, activity: str, pregnant: bool
) -> Limits:
    resting = resting_energy(sex, weight_kg, height_cm, age)
    keep = maintenance(resting, activity)
    highest = round(keep * (1 + MAX_SURPLUS))
    if age < 18:
        return Limits(
            resting,
            keep,
            keep,
            highest,
            "Noted doesn't set targets below maintenance for under-18s.",
        )
    if pregnant:
        return Limits(
            resting,
            keep,
            keep,
            highest,
            "Noted doesn't suggest eating less while pregnant or breastfeeding.",
        )
    if bmi(weight_kg, height_cm) < 18.5:
        return Limits(
            resting,
            keep,
            keep,
            highest,
            "Your weight is already under the healthy range for your height.",
        )
    lowest = max(resting, FLOORS[sex], round(keep * (1 - MAX_DEFICIT)))
    return Limits(
        resting,
        keep,
        min(lowest, keep),
        highest,
        f"Noted keeps targets at or above {lowest:,} kcal: your resting energy, "
        f"{FLOORS[sex]:,} kcal, and no more than {round(MAX_DEFICIT * 100)}% under maintenance.",
    )


def weekly_change(maintenance_kcal: int, target_kcal: int) -> float:
    return round((target_kcal - maintenance_kcal) * 7 / KCAL_PER_KG, 2)


def macro_energy(protein: float, carbs: float, fat: float) -> float:
    return protein * 4 + carbs * 4 + fat * 9
