import { useEffect, useState } from "react";
import { readStoredValue, removeStoredValue, writeStoredValue } from "../../../lib/storage";

export function useDraft(channelId: string) {
  const storageKey = `noted.draft.${channelId}`;
  const [draft, setDraft] = useState(() => readStoredValue(storageKey) ?? "");

  useEffect(() => {
    if (draft) writeStoredValue(storageKey, draft);
    else removeStoredValue(storageKey);
  }, [draft, storageKey]);

  function clearSentDraft(content: string) {
    if (readStoredValue(storageKey) === content) removeStoredValue(storageKey);
    setDraft((current) => (current === content ? "" : current));
  }

  return { draft, setDraft, clearSentDraft };
}
