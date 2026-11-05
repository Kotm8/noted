import { request } from "../../lib/http";
import type { Habit, HabitFields, HabitBoard, HabitProgress } from "./types";

export const habitsApi = {
  board: (start: string, end: string) =>
    request<HabitBoard>(`/habits?start=${start}&end=${end}`),
  create: (fields: HabitFields) => request<Habit>("/habits", "POST", fields),
  update: (habit: Habit) => request<Habit>(`/habits/${habit.id}`, "PUT", habit),
  remove: (habit: Habit) =>
    request<void>(`/habits/${habit.id}?revision=${habit.revision}`, "DELETE"),
  progress: (habitId: string, day: string, value: number, revision: number) =>
    request<HabitProgress>(`/habits/${habitId}/progress`, "PUT", {
      day,
      value,
      revision,
    }),
};
