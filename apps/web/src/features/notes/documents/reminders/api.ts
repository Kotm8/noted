import { request } from "../../../../lib/http";
import type { ReminderSchedule } from "../../../reminders/types";

export interface DocumentReminder extends ReminderSchedule {
  id: string;
  channel_id: string;
  name: string;
  status: "active" | "done" | "cancelled";
  revision: number;
}

export const documentRemindersApi = {
  list: (channel: string) =>
    request<DocumentReminder[]>(`/channels/${channel}/document/reminders`),
  create: (
    channel: string,
    id: string,
    name: string,
    schedule: ReminderSchedule,
  ) =>
    request<DocumentReminder>(
      `/channels/${channel}/document/reminders`,
      "POST",
      { id, name, ...schedule },
    ),
  update: (item: DocumentReminder, schedule: ReminderSchedule) =>
    request<DocumentReminder>(`/document-reminders/${item.id}`, "PUT", {
      ...schedule,
      revision: item.revision,
    }),
  act: (item: DocumentReminder, action: "done" | "restore" | "snooze") =>
    request<DocumentReminder>(
      `/document-reminders/${item.id}/actions`,
      "POST",
      { action, revision: item.revision },
    ),
  remove: (item: DocumentReminder) =>
    request<void>(
      `/document-reminders/${item.id}?revision=${item.revision}`,
      "DELETE",
    ),
};
