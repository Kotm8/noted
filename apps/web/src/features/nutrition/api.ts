import { request } from "../../lib/http";
import { runAi } from "../ai/api";
import type {
  DaySummary,
  Meal,
  MealFields,
  MealItem,
  NutritionEvent,
  NutritionState,
  Profile,
  ProfileFields,
  SavedMeal,
  Slot,
  Target,
  TargetFields,
  TrainingSummary,
  WeighIn,
} from "./types";

export const nutritionApi = {
  state: () => request<NutritionState>("/nutrition"),
  saveProfile: (profile: ProfileFields) =>
    request<Profile>("/nutrition/profile", "PUT", profile),
  training: () => request<TrainingSummary>("/nutrition/training"),
  acceptTarget: (target: TargetFields) =>
    request<Target>("/nutrition/target", "PUT", target),
  days: (start: string, end: string) =>
    request<DaySummary[]>(`/nutrition/days?start=${start}&end=${end}`),
  meals: (start: string, end: string) =>
    request<Meal[]>(`/nutrition/meals?start=${start}&end=${end}`),
  addMeal: (meal: MealFields) =>
    request<Meal>("/nutrition/meals", "POST", meal),
  editMeal: (id: string, meal: MealFields & { revision: number }) =>
    request<Meal>(`/nutrition/meals/${id}`, "PUT", meal),
  removeMeal: (meal: Meal) =>
    request<void>(
      `/nutrition/meals/${meal.id}?revision=${meal.revision}`,
      "DELETE",
    ),
  addSaved: (name: string, items: MealItem[]) =>
    request<SavedMeal>("/nutrition/saved-meals", "POST", { name, items }),
  editSaved: (
    id: string,
    saved: { name: string; items: MealItem[]; revision: number },
  ) => request<SavedMeal>(`/nutrition/saved-meals/${id}`, "PUT", saved),
  removeSaved: (id: string) =>
    request<void>(`/nutrition/saved-meals/${id}`, "DELETE"),
  weighIn: (day: string, weight_kg: number) =>
    request<WeighIn>("/nutrition/weigh-ins", "PUT", { day, weight_kg }),
  makePicture: (mealId: string) =>
    request<{ id: string }>(`/ai/nutrition/meals/${mealId}/picture`, "POST"),
  uploadPhoto: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ id: string; width: number; height: number }>(
      "/nutrition/photos",
      "POST",
      body,
    );
  },
};

export const photoUrl = (id: string) => `/api/v1/nutrition/photos/${id}`;

export function streamEstimate(
  input: { text: string; photo_ids: string[]; slot?: Slot },
  onEvent: (event: NutritionEvent) => void,
  signal?: AbortSignal,
) {
  return runAi(
    input as never,
    (event) => onEvent(event as unknown as NutritionEvent),
    signal,
    "/ai/nutrition/estimate",
  );
}

export function streamTarget(
  profile: ProfileFields,
  onEvent: (event: NutritionEvent) => void,
  signal?: AbortSignal,
) {
  return runAi(
    { profile } as never,
    (event) => onEvent(event as unknown as NutritionEvent),
    signal,
    "/ai/nutrition/target",
  );
}
