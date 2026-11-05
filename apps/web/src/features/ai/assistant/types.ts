import type { HabitFields } from "../../habits/types";
import type { PlanFields } from "../../schedule/types";
import type { MealItem, Slot } from "../../nutrition/types";

export interface HabitChange {
  id: string | null;
  revision: number | null;
  fields: HabitFields;
}
export interface PlanChange {
  id: string | null;
  revision: number | null;
  scope: "series" | "occurrence";
  occurrence_date: string | null;
  fields: PlanFields;
}
export interface MealChange {
  id: string | null;
  revision: number | null;
  fields: {
    day: string;
    minute: number;
    slot: Slot;
    name: string;
    items: MealItem[];
  };
  picture: boolean;
}
export interface AssistantProposal {
  explanation: string;
  habits: HabitChange[];
  plans: PlanChange[];
  meals: MealChange[];
}
