import type { AiSource } from "../ai/api";

export type Slot = "Breakfast" | "Lunch" | "Dinner" | "Snack";
export const SLOTS: Slot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];
export type Sex = "male" | "female" | "unspecified";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very"
  | "athlete";
export type Confidence = "high" | "medium" | "low";

export interface MealItem {
  name: string;
  amount: string;
  grams?: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
}

export interface MealFields {
  day: string;
  minute: number;
  slot: Slot;
  name: string;
  items: MealItem[];
  source: "ai" | "saved" | "manual";
  saved_meal_id: string | null;
  photo_ids: string[];
  remember: boolean;
}

export interface Meal extends Omit<MealFields, "remember"> {
  id: string;
  revision: number;
}

export interface SavedMeal {
  id: string;
  name: string;
  items: MealItem[];
  uses: number;
  revision: number;
}

export interface ProfileFields {
  age: number;
  sex: Sex;
  height_cm: number;
  weight_kg: number;
  activity: ActivityLevel;
  goal: string;
  pace: "gentle" | "standard";
  pregnant: boolean;
  read_training: boolean;
}

export interface Profile extends ProfileFields {
  revision: number;
}

export interface TargetFields {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  explanation: string;
  sources: AiSource[];
}

export interface Target extends TargetFields {
  id: string;
  starts_on: string;
  resting: number;
  maintenance: number;
}

export interface Limits {
  resting: number;
  maintenance: number;
  lowest: number;
  highest: number;
  reason: string;
  factor: number;
  age: number;
}

export interface WeighIn {
  day: string;
  weight_kg: number;
}

export interface NutritionState {
  today: string;
  timezone: string;
  profile: Profile | null;
  target: Target | null;
  limits: Limits | null;
  saved_meals: SavedMeal[];
  weigh_ins: WeighIn[];
}

export interface DaySummary {
  day: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  meals: number;
  target: number | null;
}

export interface TrainingSummary {
  activities: {
    name: string;
    sessions: number;
    days: number;
    average_minutes: number;
  }[];
  habits: string[];
}

export interface Choice {
  label: string;
  item: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEstimate {
  name: string;
  slot?: Slot | null;
  items: MealItem[];
  saved_meal: string | null;
  question: { text: string; choices: Choice[] } | null;
  note: string;
}

export interface TargetProposal extends Limits {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  activity: ActivityLevel;
  explanation: string;
  clamped: boolean;
  weekly_kg: number;
  sources: AiSource[];
}

export type NutritionEvent =
  | { type: "start"; run_id: string | null; model: string }
  | { type: "thinking"; heading?: string }
  | { type: "search"; query: string }
  | { type: "sources"; sources: AiSource[] }
  | { type: "writing" }
  | { type: "items"; items: MealItem[]; thought_seconds?: number }
  | {
      type: "done";
      output: MealEstimate | TargetProposal;
      sources?: AiSource[];
      thought_seconds?: number;
      searched?: boolean;
    }
  | { type: "error"; code: string; message: string };

export const ACTIVITIES: [ActivityLevel, string, string][] = [
  ["sedentary", "Sedentary", "Desk most of the day, little exercise"],
  ["light", "Light", "Exercise 1–3 days a week"],
  ["moderate", "Moderate", "Exercise 3–5 days a week"],
  ["very", "Very active", "Hard exercise 6–7 days a week"],
  ["athlete", "Athlete", "Training twice a day or a physical job"],
];

export const kcal = (value: number) =>
  Math.round(value).toLocaleString("en-GB");

export function totals(items: MealItem[]) {
  return items.reduce(
    (sum, item) => ({
      kcal: sum.kcal + item.kcal,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function slotFor(minute: number): Slot {
  if (minute >= 300 && minute < 660) return "Breakfast";
  if (minute >= 660 && minute < 960) return "Lunch";
  if (minute >= 1020 && minute < 1350) return "Dinner";
  return "Snack";
}

/** Scales an item's calories and macros together, keeping one decimal for grams. */
export function scaleItem(item: MealItem, factor: number): MealItem {
  const round = (value: number) => Math.round(value * factor * 10) / 10;
  return {
    ...item,
    kcal: Math.round(item.kcal * factor),
    protein: round(item.protein),
    carbs: round(item.carbs),
    fat: round(item.fat),
    grams: item.grams == null ? item.grams : Math.round(item.grams * factor),
    amount:
      factor === 1
        ? item.amount
        : `${Math.round(factor * 100)}% of ${item.amount || "a portion"}`,
  };
}

/** A moving average over the last four weigh-ins, so one salty dinner doesn't read as a trend. */
export function trend(points: WeighIn[]): number[] {
  return points.map((_, index) => {
    const window = points.slice(Math.max(0, index - 3), index + 1);
    return (
      window.reduce((sum, point) => sum + point.weight_kg, 0) / window.length
    );
  });
}
