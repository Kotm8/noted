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
  create: (data: PlanFields & { client_id?: string }) =>
    request<SchedulePlan>("/schedule/plans", "POST", data),
  get: (id: string) => request<SchedulePlan>(`/schedule/plans/${id}`),
  update: (id: string, data: PlanUpdate) =>
    request<SchedulePlan>(`/schedule/plans/${id}`, "PUT", data),
  restore: (id: string, revision: number) =>
    request<SchedulePlan>(
      `/schedule/plans/${id}/restore?${new URLSearchParams({ revision: String(revision) })}`,
      "POST",
    ),
  remove: (id: string, revision: number, occurrence?: string, reset = false) =>
    request<SchedulePlan>(
      `/schedule/plans/${id}?${new URLSearchParams({ revision: String(revision), ...(occurrence ? { occurrence_date: occurrence } : {}), reset: String(reset) })}`,
      "DELETE",
    ),
};
