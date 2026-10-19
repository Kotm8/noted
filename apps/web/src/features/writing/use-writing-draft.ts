import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "../../lib/storage";
export interface WritingDraft {
  title: string;
  content: string;
  revision: number;
}

interface WritingRecord extends WritingDraft {
  id: string;
  channel_id: string;
}

interface DraftOptions<T extends WritingRecord> {
  storageKey: string;
  queryKey: string[];
  listKey?: string[];
  update: (id: string, draft: WritingDraft) => Promise<T>;
  get: (id: string) => Promise<T>;
}

function restoredDraft(entry: WritingRecord, key: string): WritingDraft {
  const fallback = {
    title: entry.title,
    content: entry.content,
    revision: entry.revision,
  };
  try {
    const draft = JSON.parse(readStoredValue(key) || "null");
    if (
      draft &&
      typeof draft.title === "string" &&
      draft.title.length <= 120 &&
      typeof draft.content === "string" &&
      draft.content.length <= 200000 &&
      Number.isInteger(draft.revision) &&
      draft.revision >= 0
    )
      return draft;
  } catch {
    return fallback;
  }
  return fallback;
}

export function useWritingDraft<T extends WritingRecord>(
  entry: T,
  options: DraftOptions<T>,
) {
  const client = useQueryClient();
  const key = options.storageKey;
  const [draft, setDraftState] = useState(() => restoredDraft(entry, key));
  const latest = useRef(draft);
  const revision = useRef(draft.revision);
  const saved = useRef({ title: entry.title, content: entry.content });
  const running = useRef<Promise<void> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(() =>
    draft.revision !== entry.revision
      ? new Error(
          "This document changed on another device. Your draft has been kept.",
        )
      : null,
  );
  const blocked = useRef(error);
  const dirty =
    draft.title !== saved.current.title ||
    draft.content !== saved.current.content;

  function setDraft(changes: Partial<Pick<WritingDraft, "title" | "content">>) {
    const next = { ...latest.current, ...changes, revision: revision.current };
    latest.current = next;
    setDraftState(next);
    writeStoredValue(key, JSON.stringify(next));
  }

  function flush(): Promise<void> {
    if (running.current) return running.current;
    if (blocked.current) return Promise.reject(blocked.current);
    if (
      latest.current.title === saved.current.title &&
      latest.current.content === saved.current.content
    )
      return Promise.resolve();
    if (!latest.current.title.trim()) {
      const reason = new Error("Give the entry a name before saving.");
      blocked.current = reason;
      setError(reason);
      return Promise.reject(reason);
    }
    const operation = async () => {
      setSaving(true);
      try {
        while (
          latest.current.title !== saved.current.title ||
          latest.current.content !== saved.current.content
        ) {
          if (!latest.current.title.trim())
            throw new Error("Give the entry a name before saving.");
          const snapshot = { ...latest.current, revision: revision.current };
          const updated = await options.update(entry.id, snapshot);
          revision.current = updated.revision;
          saved.current = { title: updated.title, content: updated.content };
          latest.current = {
            ...latest.current,
            title:
              latest.current.title === snapshot.title
                ? updated.title
                : latest.current.title,
            revision: updated.revision,
          };
          setDraftState(latest.current);
          writeStoredValue(key, JSON.stringify(latest.current));
          client.setQueryData(options.queryKey, updated);
        }
        removeStoredValue(key);
        if (options.listKey)
          void client.invalidateQueries({ queryKey: options.listKey });
        void client.invalidateQueries({ queryKey: ["search"] });
      } catch (failure) {
        const reason =
          failure instanceof Error
            ? failure
            : new Error("Could not save this document.");
        blocked.current = reason;
        setError(reason);
        throw reason;
      } finally {
        running.current = null;
        setSaving(false);
      }
    };
    running.current = operation();
    return running.current;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!dirty || error) return;
    const timer = window.setTimeout(
      () => void flushRef.current().catch(() => undefined),
      600,
    );
    return () => window.clearTimeout(timer);
  }, [draft, dirty, error]);

  useEffect(
    () => () => {
      void flushRef.current().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saving) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  useEffect(() => {
    if (entry.revision <= revision.current) return;
    if (
      latest.current.title !== saved.current.title ||
      latest.current.content !== saved.current.content
    ) {
      const reason = new Error(
        "This document changed on another device. Your draft has been kept.",
      );
      blocked.current = reason;
      setError(reason);
      return;
    }
    saved.current = { title: entry.title, content: entry.content };
    revision.current = entry.revision;
    latest.current = { ...saved.current, revision: entry.revision };
    setDraftState(latest.current);
  }, [entry]);

  function retry() {
    blocked.current = null;
    setError(null);
    return flush();
  }
  async function reload() {
    const updated = await options.get(entry.id);
    saved.current = { title: updated.title, content: updated.content };
    revision.current = updated.revision;
    latest.current = { ...saved.current, revision: updated.revision };
    blocked.current = null;
    setError(null);
    setDraftState(latest.current);
    removeStoredValue(key);
    client.setQueryData(options.queryKey, updated);
  }
  return { draft, setDraft, dirty, saving, error, flush, retry, reload };
}
