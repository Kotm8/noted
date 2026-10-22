import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Eye, LoaderCircle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import type { Channel } from "../../workspaces/types";
import { useWritingDraft } from "../../writing/use-writing-draft";
import { MarkdownWritingArea } from "../../writing/markdown-writing-area";
import { documentApi, type NoteDocument } from "./api";
import { documentQuery } from "./queries";

export function DocumentPage({ channel }: { channel: Channel }) {
  const query = useQuery(documentQuery(channel));
  if (query.data)
    return (
      <DocumentEditor
        key={channel.id}
        entry={{ ...query.data, title: channel.name }}
      />
    );
  return (
    <div className="channel-document-loading">
      {query.isError ? (
        <Notice tone="error">
          {query.error.message}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Notice>
      ) : (
        <LoaderCircle size={20} className="animate-spin" />
      )}
    </div>
  );
}

function DocumentEditor({ entry }: { entry: NoteDocument }) {
  const api = documentApi(entry.title);
  const model = useWritingDraft(entry, {
    storageKey: `noted.document-draft.${entry.id}`,
    queryKey: ["channel-document", entry.id],
    update: api.update,
    get: api.get,
  });
  const [editing, setEditing] = useState(!entry.content);
  const [reload, setReload] = useState(false);
  return (
    <section
      className="channel-document"
      aria-label="Notes document"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void model.retry().catch(() => undefined);
        }
      }}
    >
      <div className="journal-tools document-tools">
        <button
          className="icon-button"
          type="button"
          aria-label={editing ? "Preview note" : "Edit note"}
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
          aria-label="Save note"
          disabled={model.saving || !model.dirty}
          onClick={() => void model.retry().catch(() => undefined)}
        >
          <Check size={16} />
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
                  .writeText(model.draft.content)
                  .then(() => toast.success("Draft copied"))
                  .catch(() => toast.error("Could not copy the draft"))
              }
            >
              Copy draft
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setReload(true)}
            >
              Load saved version
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={() => void model.retry().catch(() => undefined)}
            >
              Retry save
            </Button>
          </div>
        </div>
      )}
      <div className="journal-page document-page">
        <h1>{entry.title}</h1>
        <MarkdownWritingArea
          content={model.draft.content}
          onChange={(content) => model.setDraft({ content })}
          editing={editing}
          pending={model.saving}
          label="Note contents"
          onEdit={() => setEditing(true)}
        />
      </div>
      <Modal
        open={reload}
        onOpenChange={setReload}
        title="Load saved version"
        description="This replaces your local draft with the server version. Copy your draft first to keep it."
      >
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setReload(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void model
                .reload()
                .then(() => setReload(false))
                .catch((error: Error) => toast.error(error.message))
            }
          >
            Load saved version
          </Button>
        </div>
      </Modal>
    </section>
  );
}
