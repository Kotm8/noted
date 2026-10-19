import { useWritingDraft } from "../writing/use-writing-draft";
import { journalsApi } from "./api";
import type { JournalEntry } from "./types";

export function useJournalDraft(entry: JournalEntry) {
  return useWritingDraft(entry, {
    storageKey: `noted.journal-draft.${entry.id}`,
    queryKey: ["journal-entry", entry.id],
    listKey: ["journals", entry.channel_id],
    update: journalsApi.update,
    get: journalsApi.get,
  });
}
