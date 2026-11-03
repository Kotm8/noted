import type { Activity } from "../time-tracking/types";
import type { PlanFields } from "./types";

/** A blank title falls back to the activity's name, so naming a plan is optional. */
export function planTitle(fields: PlanFields, activities: Activity[]) {
  return (
    fields.title.trim() ||
    activities.find((item) => item.id === fields.activity_id)?.name ||
    "Plan"
  );
}
