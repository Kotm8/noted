import {
  useContext,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  PilotOriginContext,
  PilotOwnerContext,
} from "../../../lib/android-pilot";
import { forgetFiles, keepFiles, readFiles } from "../outbox-files";

export function useComposerFiles(draftId: string) {
  const origin = useContext(PilotOriginContext);
  const owner = useContext(PilotOwnerContext);
  const storageKey =
    origin && owner ? JSON.stringify(["draft", origin, owner, draftId]) : null;
  const [selection, setSelection] = useState<{
    key: string | null;
    files: File[];
  }>({
    key: null,
    files: [],
  });
  const [writes, setWrites] = useState(0);
  const pending = useRef(Promise.resolve());
  const files = selection.key === storageKey ? selection.files : [];
  const filesLoading = selection.key !== storageKey || writes > 0;

  useEffect(() => {
    if (!storageKey) return;
    let active = true;
    void readFiles(storageKey).then(
      (saved) => {
        if (active) setSelection({ key: storageKey, files: saved ?? [] });
      },
      () => {
        if (!active) return;
        toast.error("Couldn't read the saved draft attachments.");
        setSelection({ key: storageKey, files: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [storageKey]);

  function setFiles(update: SetStateAction<File[]>) {
    const selected = (current: File[]) =>
      typeof update === "function" ? update(current) : update;
    if (!storageKey) {
      setSelection((current) => ({
        key: null,
        files: selected(current.files),
      }));
      return;
    }
    setWrites((count) => count + 1);
    pending.current = pending.current
      .then(async () => {
        const next = selected((await readFiles(storageKey)) ?? []);
        if (next.length) await keepFiles(storageKey, next);
        else await forgetFiles(storageKey);
        setSelection({ key: storageKey, files: next });
      })
      .catch(() =>
        toast.error("Couldn't save the draft attachments on this phone."),
      )
      .then(() => {
        setWrites((count) => count - 1);
      });
  }

  function addFiles(incoming: File[]) {
    const next = [...files, ...incoming];
    if (
      next.length > 10 ||
      next.some((file) => file.size > 250 * 1024 * 1024) ||
      next.reduce((size, file) => size + file.size, 0) > 500 * 1024 * 1024
    ) {
      toast.error("Choose up to 10 files, 250 MB each and 500 MB total.");
      return;
    }
    setFiles(next);
  }
  return { files, setFiles, addFiles, filesLoading };
}
