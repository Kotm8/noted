import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Notice } from "../../../components/ui/notice";
import { Modal } from "../../../components/ui/dialog";
import { notesApi } from "../api";
import type { Note, NoteVersion } from "../types";
import { Markdown } from "./markdown";

const when = (value: string) =>
  new Date(value).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/**
 * The History button in a message's toolbar, shown only once it was edited. It opens every
 * earlier text, newest first. Restoring one keeps the current text as a version too.
 */
export function EditHistory({
  note,
  onClose,
}: {
  note: Note;
  onClose?: () => void;
}) {
  const [popoverOpen, setOpen] = useState(false);
  const open = Boolean(onClose) || popoverOpen;
  const client = useQueryClient();
  const versions = useQuery({
    queryKey: ["note-versions", note.id, note.updated_at],
    queryFn: () => notesApi.versions(note.id),
    enabled: open,
  });
  const restore = useMutation({
    mutationFn: (version: NoteVersion) =>
      notesApi.restore(note.id, version.id, note.content),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notes", note.channel_id] });
      void client.invalidateQueries({ queryKey: ["thread"] });
      if (onClose) onClose();
      else setOpen(false);
      toast.success("Earlier version restored");
    },
    onError: (error) => toast.error(error.message),
  });
  const content = (
    <>
      <ol>
        <li className="edit-history-current">
          <span className="edit-history-time">
            Current · {when(note.updated_at)}
          </span>
          <Markdown content={note.content} />
        </li>
        {versions.isPending && (
          <li className="edit-history-loading">
            <LoaderCircle size={16} className="spin" />
          </li>
        )}
        {versions.data?.map((version) => (
          <li key={version.id}>
            <span className="edit-history-time">
              {when(version.written_at)}
              <button
                type="button"
                disabled={restore.isPending}
                onClick={() => restore.mutate(version)}
              >
                Restore
              </button>
            </span>
            <Markdown content={version.content} />
          </li>
        ))}
        {versions.data?.length === 0 && (
          <li className="edit-history-empty">
            No earlier versions are saved for this message.
          </li>
        )}
      </ol>
      {versions.isError && (
        <Notice tone="error">{versions.error.message}</Notice>
      )}
    </>
  );
  if (onClose)
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="Edit history"
        description="Restore an earlier version of this message."
        className="edit-history-dialog"
      >
        {content}
      </Modal>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="icon-button"
          aria-label="Edit history"
          title={`Edited ${when(note.updated_at)}. Show earlier versions`}
        >
          <History size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="edit-history"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Edit history"
        >
          <header>
            <History size={14} />
            Edit history
          </header>
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
