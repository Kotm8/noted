import { request } from "../../lib/http";
import type { Note, NoteCursor, NotePage } from "../notes/types";

export interface ThreadPage {
  root: Note;
  replies: NotePage;
}

export const threadsApi = {
  read(id: string, cursor: NoteCursor = {}): Promise<ThreadPage> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(cursor))
      if (value) parameters.set(key, value);
    return request(`/messages/${id}/thread?${parameters}`);
  },
  reply(id: string, content: string): Promise<Note> {
    return request(`/messages/${id}/thread`, "POST", { content });
  },
};
