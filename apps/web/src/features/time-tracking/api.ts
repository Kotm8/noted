import { request } from "../../lib/http";
import type {
  Activity,
  TimeSession,
  Tracker,
  TrackerAction,
  TrackingPreferences,
} from "./types";

export const trackingApi = {
  tracker: () => request<Tracker>("/time-tracking/tracker"),
  activities: () => request<Activity[]>("/time-tracking/activities"),
  act: (action: TrackerAction, revision: number, activity_id?: string) =>
    request<Tracker>("/time-tracking/tracker", "POST", {
      action,
      revision,
      activity_id,
      request_id: crypto.randomUUID(),
    }),
  preferences: (data: TrackingPreferences, revision: number) =>
    request<Tracker>("/time-tracking/preferences", "PUT", {
      ...data,
      revision,
    }),
  createActivity: (data: Pick<Activity, "name" | "icon" | "color">) =>
    request<Activity>("/time-tracking/activities", "POST", data),
  updateActivity: (data: Activity) =>
    request<Activity>(`/time-tracking/activities/${data.id}`, "PUT", data),
  reorder: (ids: string[]) =>
    request<Activity[]>("/time-tracking/activities/order", "PUT", { ids }),
  updateSession: (data: TimeSession & { ended_at: string }) =>
    request<TimeSession>(`/time-tracking/sessions/${data.id}`, "PUT", data),
  removeSession: (data: TimeSession) =>
    request<void>(
      `/time-tracking/sessions/${data.id}?revision=${data.revision}`,
      "DELETE",
    ),
};
