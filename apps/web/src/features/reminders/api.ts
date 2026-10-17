import { request } from "../../lib/http";
import type { Reminder, ReminderSchedule } from "./types";

export const remindersApi = {
  schedule: (id: string, schedule: ReminderSchedule) =>
    request<Reminder>(`/messages/${id}/reminder`, "PUT", schedule),
  act: (
    id: string,
    revision: number,
    action: "done" | "restore" | "snooze",
    minutes?: number,
  ) =>
    request<Reminder>(`/messages/${id}/reminder/actions`, "POST", {
      revision,
      action,
      minutes,
    }),
};
