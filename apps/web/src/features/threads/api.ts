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
  reply(id: string, content: string, clientId?: string): Promise<Note> {
    return request(`/messages/${id}/thread`, "POST", {
      content,
      client_id: clientId,
    });
  },
  replyWithFiles(
    id: string,
    content: string,
    files: File[],
    clientId?: string,
  ): Promise<Note> {
    const body = new FormData();
    body.append("content", content);
    if (clientId) body.append("client_id", clientId);
    files.forEach((file) => body.append("files", file));
    return request(`/messages/${id}/thread/with-files`, "POST", body);
  },
};
