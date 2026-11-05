import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import { Markdown } from "../../notes/components/markdown";
import { templatesApi, useNoteTemplates } from "../api";
import type { NoteTemplate } from "../types";
import { useTemplateSelection } from "../use-template-selection";
import { TemplateList } from "./template-list";

export function NoteTemplatesPanel() {
  const query = useNoteTemplates();
  const selection = useTemplateSelection();
  const [busy, setBusy] = useState(false);
  const items = query.data ?? [];
  const item =
    selection.id === ""
      ? null
      : (items.find((entry) => entry.id === selection.id) ?? items[0]);
  return (
    <section className="settings-panel note-templates-panel">
      <div className="template-section-heading">
        <div>
          <h2>Note templates</h2>
          <p>Your own starting points for messages, journals, and notes.</p>
        </div>
        <Button
          size="small"
          variant="secondary"
          disabled={busy}
          onClick={() => selection.select("")}
        >
          <Plus size={14} />
          New
        </Button>
      </div>
      {query.error && (
        <Notice tone="error">
          {query.error.message}
          <button onClick={() => void query.refetch()}>Reload</button>
        </Notice>
      )}
      {query.isPending ? (
        <p className="template-empty">Loading templates…</p>
      ) : (
        <div className="template-manager note-template-manager">
          <TemplateList
            items={items.map((entry) => ({
              ...entry,
              detail: `${entry.content.split("\n").length} lines`,
            }))}
            selected={item?.id ?? ""}
            kind="note"
            search
            onSelect={(id) => {
              if (id !== item?.id) selection.select(id);
            }}
            onNew={() => selection.select("")}
            disabled={busy}
          />
          {item || selection.id === "" ? (
            <NoteTemplateEditor
              key={`${item?.id ?? "new"}:${selection.version}`}
              initial={item ?? { id: "", name: "", content: "", revision: 0 }}
              onSaved={(saved) => selection.setId(saved?.id ?? null)}
              onDirty={selection.setDirty}
              onBusy={setBusy}
            />
          ) : (
            <p className="template-empty">
              Create a template, then insert a copy from the writing toolbar.
            </p>
          )}
        </div>
      )}
      {selection.confirmation}
    </section>
  );
}

function NoteTemplateEditor({
  initial,
  onSaved,
  onDirty,
  onBusy,
}: {
  initial: NoteTemplate;
  onSaved: (item: NoteTemplate | null) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const client = useQueryClient();
  const dirty = draft.name !== base.name || draft.content !== base.content;
  const stale = initial.revision !== base.revision;
  const save = useMutation({
    mutationFn: () => templatesApi.saveNote(draft),
    onSuccess: (item) => {
      client.setQueryData<NoteTemplate[]>(["templates", "notes"], (items) =>
        [...(items ?? []).filter((entry) => entry.id !== item.id), item].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setDraft(item);
      setBase(item);
      onSaved(item);
      void client.invalidateQueries({ queryKey: ["templates", "notes"] });
      toast.success("Template saved");
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: ["templates", "notes"] }),
  });
  const remove = useMutation({
    mutationFn: () => templatesApi.remove("notes", draft.id, draft.revision),
    onSuccess: async () => {
      onDirty(false);
      await client.invalidateQueries({ queryKey: ["templates", "notes"] });
      onSaved(null);
      toast.success("Template deleted");
    },
  });
  const pending = save.isPending || remove.isPending;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    onBusy(pending);
    return () => onBusy(false);
  }, [pending, onBusy]);
  return (
    <form
      className="note-template-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !stale) save.mutate();
      }}
    >
      <label>
        Template name
        <input
          required
          maxLength={70}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={pending}
        />
      </label>
      <div className="template-editor-toolbar">
        <div>
          <button
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            <FileText size={13} />
            Markdown
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            <Eye size={13} />
            Preview
          </button>
        </div>
        <span>{draft.content.split("\n").length} lines</span>
      </div>
      {preview ? (
        <div className="template-markdown-preview">
          <Markdown content={draft.content} />
        </div>
      ) : (
        <textarea
          aria-label="Template Markdown"
          spellCheck={false}
          maxLength={40000}
          value={draft.content}
          onChange={(event) =>
            setDraft({ ...draft, content: event.target.value })
          }
          disabled={pending}
        />
      )}
      {stale && (
        <Notice>
          This template changed on another device.
          <button
            type="button"
            onClick={() => {
              setDraft(initial);
              setBase(initial);
            }}
          >
            Reload saved version
          </button>
        </Notice>
      )}
      {(save.error || remove.error) && (
        <Notice tone="error">{(save.error ?? remove.error)?.message}</Notice>
      )}
      <div className="template-editor-footer">
        <span>
          <Info size={13} />
          Spacing stays exactly as written.
        </span>
        <div>
          {draft.id && (
            <button
              type="button"
              className="icon-button"
              aria-label="Delete template"
              onClick={() => setDeleting(true)}
              disabled={pending}
            >
              <Trash2 size={15} />
            </button>
          )}
          <Button
            size="small"
            type="submit"
            disabled={pending || stale || !draft.name.trim()}
          >
            {save.isPending ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        pending={pending}
        title="Delete this template?"
        description="Copies already inserted into your notes will stay."
        keepLabel="Keep template"
        confirmLabel="Delete template"
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </form>
  );
}
