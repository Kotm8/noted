import { request } from "../../lib/http";
import type {
  PlanFields,
  PlanUpdate,
  ScheduleBoard,
  SchedulePlan,
} from "./types";

export const scheduleApi = {
  board: (start: string, end: string) =>
    request<ScheduleBoard>(`/schedule?${new URLSearchParams({ start, end })}`),
  create: (data: PlanFields) =>
    request<SchedulePlan>("/schedule/plans", "POST", data),
  get: (id: string) => request<SchedulePlan>(`/schedule/plans/${id}`),
  update: (id: string, data: PlanUpdate) =>
    request<SchedulePlan>(`/schedule/plans/${id}`, "PUT", data),
  remove: (id: string, revision: number, occurrence?: string, reset = false) =>
    request<SchedulePlan>(
      `/schedule/plans/${id}?${new URLSearchParams({ revision: String(revision), ...(occurrence ? { occurrence_date: occurrence } : {}), reset: String(reset) })}`,
      "DELETE",
    ),
};
