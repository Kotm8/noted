import { request } from "../../lib/http";
import type { Note, NoteCursor, NotePage } from "./types";
import type { ReminderSchedule } from "../reminders/types";

export const notesApi = {
  list(channelId: string, cursor: NoteCursor): Promise<NotePage> {
    const query = new URLSearchParams();
    if (cursor.before) query.set("before", cursor.before);
    if (cursor.after) query.set("after", cursor.after);
    if (cursor.around) query.set("around", cursor.around);
    return request<NotePage>(`/channels/${channelId}/messages?${query}`);
  },

  create(
    channelId: string,
    content: string,
    reminder?: ReminderSchedule,
  ): Promise<Note> {
    return request<Note>(`/channels/${channelId}/messages`, "POST", {
      content,
      reminder,
    });
  },

  createWithFiles(
    channelId: string,
    content: string,
    files: File[],
    reminder?: ReminderSchedule,
  ): Promise<Note> {
    const body = new FormData();
    body.append("content", content);
    if (reminder) body.append("reminder", JSON.stringify(reminder));
    files.forEach((file) => body.append("files", file));
    return request<Note>(
      `/channels/${channelId}/messages/with-files`,
      "POST",
      body,
    );
  },

  update(id: string, content: string, expected_content?: string): Promise<Note> {
    return request<Note>(`/messages/${id}`, "PUT", { content, expected_content });
  },

  remove(id: string): Promise<void> {
    return request<void>(`/messages/${id}`, "DELETE");
  },
};
