import { request } from "../../lib/http";
import type { JournalDraft, JournalEntry, JournalSummary } from "./types";

export const journalsApi = {
  list(channelId: string, offset = 0): Promise<JournalSummary[]> {
    return request(`/channels/${channelId}/journal?limit=50&offset=${offset}`);
  },
  create(channelId: string, title: string): Promise<JournalEntry> {
    return request(`/channels/${channelId}/journal`, "POST", { title });
  },
  get(id: string): Promise<JournalEntry> {
    return request(`/journal/${id}`);
  },
  update(id: string, data: JournalDraft): Promise<JournalEntry> {
    return request(`/journal/${id}`, "PUT", data);
  },
  remove(id: string, revision: number): Promise<void> {
    return request(`/journal/${id}?revision=${revision}`, "DELETE");
  },
};
