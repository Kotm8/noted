import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { WritingSidebar } from "../../components/ui/writing-sidebar";
import { MarkdownWritingArea } from "../writing/markdown-writing-area";
import { removeStoredValue } from "../../lib/storage";
import { journalsApi } from "./api";
import { useJournalDraft } from "./use-journal-draft";
import type { JournalEntry } from "./types";

export function JournalEditor({
  entry,
  initiallyEditing,
  onClose,
}: {
  entry: JournalEntry;
  initiallyEditing: boolean;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const model = useJournalDraft(entry);
  const [editing, setEditing] = useState(initiallyEditing);
  const [confirm, setConfirm] = useState<"delete" | "reload" | null>(null);
  const remove = useMutation({
    mutationFn: () => journalsApi.remove(entry.id, entry.revision),
    onSuccess: async () => {
      removeStoredValue(`noted.journal-draft.${entry.id}`);
      await client.invalidateQueries({
        queryKey: ["journals", entry.channel_id],
      });
      await client.invalidateQueries({ queryKey: ["search"] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <WritingSidebar
      title="Journal entry"
      onClose={() => {
        void model
          .flush()
          .then(onClose)
          .catch(() => undefined);
      }}
    >
      <div className="journal-tools">
        <button
          type="button"
          className="icon-button"
          aria-label={editing ? "Preview entry" : "Edit entry"}
          onClick={() => setEditing(!editing)}
        >
          {editing ? <Eye size={16} /> : <Pencil size={16} />}
        </button>
        <span role="status">
          {model.error
            ? "Not saved"
            : model.saving
              ? "Saving…"
              : model.dirty
                ? "Draft"
                : "Saved"}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label="Save entry"
          disabled={model.saving || !model.dirty}
          onClick={() => void model.retry().catch(() => undefined)}
        >
          <Check size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Delete entry"
          disabled={model.saving || model.dirty}
          onClick={() => setConfirm("delete")}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {model.error && (
        <div className="journal-save-error">
          <Notice tone="error">{model.error.message}</Notice>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              size="small"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${model.draft.title}\n\n${model.draft.content}`)
                  .then(() => toast.success("Draft copied"))
                  .catch(() => toast.error("Could not copy the draft"))
              }
            >
              Copy draft
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setConfirm("reload")}
            >
              Load saved version
            </Button>
            <Button variant="ghost" size="small" onClick={onClose}>
              Close and keep draft
            </Button>
          </div>
        </div>
      )}
      <div className="journal-page">
        <time className="journal-date" dateTime={entry.created_at}>
          {new Date(entry.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </time>
        <input
          className="journal-entry-title"
          aria-label="Entry title"
          value={model.draft.title}
          maxLength={120}
          onChange={(event) => model.setDraft({ title: event.target.value })}
        />
        <MarkdownWritingArea
          content={model.draft.content}
          onChange={(content) => model.setDraft({ content })}
          editing={editing}
          pending={model.saving}
          label="Entry contents"
          onEdit={() => setEditing(true)}
        />
      </div>
      <Modal
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm === "delete" ? "Delete journal entry" : "Load saved version"
        }
        description={
          confirm === "delete"
            ? "This permanently deletes this entry."
            : "This replaces your local draft with the version saved on the server. Copy your draft first if you want to keep it."
        }
      >
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm === "delete") remove.mutate();
              else
                void model
                  .reload()
                  .then(() => setConfirm(null))
                  .catch((error: Error) => toast.error(error.message));
            }}
          >
            {confirm === "delete" ? "Delete entry" : "Load saved version"}
          </Button>
        </div>
      </Modal>
    </WritingSidebar>
  );
}
