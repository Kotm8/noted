import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  PilotOriginContext,
  PilotOwnerContext,
} from "../../../lib/android-pilot";
import {
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from "../../../lib/storage";
import { keepDraftText, readDraftText } from "../outbox-files";

export function useDraft(channelId: string) {
  const origin = useContext(PilotOriginContext);
  const owner = useContext(PilotOwnerContext);
  const pilotKey =
    origin && owner
      ? JSON.stringify(["draft-text", origin, owner, channelId])
      : null;
  const storageKey = `noted.draft.${channelId}`;
  const [draft, setDraft] = useState(() =>
    pilotKey ? "" : (readStoredValue(storageKey) ?? ""),
  );
  const [ready, setReady] = useState(!pilotKey);
  const [saved, setSaved] = useState(draft);
  const scheduled = useRef<string | null>(null);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    if (!pilotKey) return;
    let active = true;
    void readDraftText(pilotKey).then(
      (value) => {
        if (!active) return;
        const text = value ?? readStoredValue(storageKey) ?? "";
        scheduled.current = value ?? "";
        setDraft(text);
        setSaved(value ?? "");
        setReady(true);
      },
      () => {
        if (active) toast.error("Couldn't read the draft saved on this phone.");
      },
    );
    return () => {
      active = false;
    };
  }, [pilotKey, storageKey]);

  useLayoutEffect(() => {
    if (pilotKey) {
      if (!ready || draft === scheduled.current) return;
      scheduled.current = draft;
      const write = writes.current.then(async () => {
        await keepDraftText(pilotKey, draft);
        if (readStoredValue(storageKey) !== null) removeStoredValue(storageKey);
        return draft;
      });
      writes.current = write.then(
        (text) => setSaved(text),
        () => {
          toast.error("Couldn't save the draft on this phone.");
        },
      );
      return;
    }
    if (draft) writeStoredValue(storageKey, draft);
    else removeStoredValue(storageKey);
  }, [draft, pilotKey, ready, storageKey]);

  function clearSentDraft(content: string) {
    if (!pilotKey && readStoredValue(storageKey) === content)
      removeStoredValue(storageKey);
    setDraft((current) => (current === content ? "" : current));
  }

  return {
    draft,
    setDraft,
    clearSentDraft,
    ready,
    draftSaved: !pilotKey || draft === saved,
  };
}
