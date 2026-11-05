import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import type { Activity, TrackingPreferences } from "../../time-tracking/types";
import { duration } from "../../schedule/dates";
import { templatesApi, useDayTemplates } from "../api";
import type { DayTemplate } from "../types";
import { useTemplateSelection } from "../use-template-selection";
import { TemplateList } from "./template-list";
import { DayTemplateTimeline } from "./day-template-timeline";
import { DayBlockCard, type EditingBlock } from "./day-block-card";

export function DayTemplatesPanel({
  activities,
  hours,
}: {
  activities: Activity[];
  hours: TrackingPreferences;
}) {
  const query = useDayTemplates();
  const selection = useTemplateSelection();
  const [busy, setBusy] = useState(false);
  const items = query.data ?? [];
  const item =
    selection.id === ""
      ? null
      : (items.find((entry) => entry.id === selection.id) ?? items[0]);
  return (
    <>
      <div className="template-section-heading">
        <div>
          <h3>Day templates</h3>
          <p>A familiar day, ready to plan again.</p>
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
        <div className="template-manager day-template-manager">
          <TemplateList
            kind="day"
            items={items.map((entry) => ({
              ...entry,
              detail: `${entry.blocks.length} blocks · ${duration(entry.blocks.reduce((sum, block) => sum + block.end_minute - block.start_minute, 0) * 60)}`,
            }))}
            selected={item?.id ?? ""}
            onSelect={(id) => {
              if (id !== item?.id) selection.select(id);
            }}
            onNew={() => selection.select("")}
            disabled={busy}
          />
          {item || selection.id === "" ? (
            <DayTemplateEditor
              key={`${item?.id ?? "new"}:${selection.version}`}
              initial={item ?? { id: "", name: "", revision: 0, blocks: [] }}
              activities={activities}
              hours={hours}
              onSaved={(saved) => selection.setId(saved?.id ?? null)}
              onDirty={selection.setDirty}
              onBusy={setBusy}
            />
          ) : (
            <p className="template-empty">
              Create a template here, or save a day from your calendar.
            </p>
          )}
        </div>
      )}
      {selection.confirmation}
    </>
  );
}

function DayTemplateEditor({
  initial,
  activities,
  hours,
  onSaved,
  onDirty,
  onBusy,
}: {
  initial: DayTemplate;
  activities: Activity[];
  hours: TrackingPreferences;
  onSaved: (item: DayTemplate | null) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [base, setBase] = useState(initial);
  const [editing, setEditing] = useState<EditingBlock | null>(null);
  const [deleting, setDeleting] = useState(false);
  const client = useQueryClient();
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const stale = initial.revision !== base.revision;
  const save = useMutation({
    mutationFn: () => templatesApi.saveDay(draft),
    onSuccess: (item) => {
      client.setQueryData<DayTemplate[]>(["templates", "days"], (items) =>
        [...(items ?? []).filter((entry) => entry.id !== item.id), item].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
      );
      setDraft(item);
      setBase(item);
      onSaved(item);
      void client.invalidateQueries({ queryKey: ["templates", "days"] });
      toast.success("Day template saved");
    },
    onError: () =>
      void client.invalidateQueries({ queryKey: ["templates", "days"] }),
  });
  const remove = useMutation({
    mutationFn: () => templatesApi.remove("days", draft.id, draft.revision),
    onSuccess: async () => {
      onDirty(false);
      await client.invalidateQueries({ queryKey: ["templates", "days"] });
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
    <div className="day-template-editor">
      <form
        className="day-template-name"
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
            disabled={pending}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <Button
          size="small"
          type="submit"
          disabled={pending || stale || !draft.name.trim()}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </form>
      <div className="day-template-meta">
        <span>{draft.blocks.length} blocks</span>
        <div>
          {draft.id && (
            <button
              type="button"
              className="icon-button"
              aria-label="Delete day template"
              disabled={pending}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            className="template-new"
            disabled={
              pending ||
              !activities.some((item) => !item.archived) ||
              draft.blocks.length >= 200
            }
            onClick={(event) =>
              setEditing({
                index: null,
                block: {
                  title: "",
                  activity_id: activities.find((item) => !item.archived)!.id,
                  start_minute: hours.start_minute,
                  end_minute: Math.min(
                    hours.end_minute,
                    hours.start_minute + 60,
                  ),
                },
                anchor: event.currentTarget.getBoundingClientRect(),
              })
            }
          >
            <Plus size={14} />
            Block
          </button>
        </div>
      </div>
      <fieldset disabled={pending} className="template-timeline-fieldset">
        <DayTemplateTimeline
          blocks={draft.blocks}
          activities={activities}
          hours={hours}
          onEdit={(value) => {
            if (!pending && (value.index !== null || draft.blocks.length < 200))
              setEditing(value);
          }}
        />
      </fieldset>
      <p className="template-inline-help">
        {activities.some((item) => !item.archived)
          ? "Click a block to edit. Click or drag empty time to add."
          : "Add an activity in Time tracking to start planning."}
      </p>
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
      <p className="template-inline-help">
        <Info size={13} />
        Applying adds one-off plans and keeps existing plans.
      </p>
      {editing && (
        <DayBlockCard
          key={`${editing.index}:${editing.anchor.left}`}
          editing={editing}
          activities={activities}
          onClose={() => setEditing(null)}
          onSave={(block) => {
            setDraft({
              ...draft,
              blocks:
                editing.index === null
                  ? [...draft.blocks, block]
                  : draft.blocks.map((item, index) =>
                      index === editing.index ? block : item,
                    ),
            });
            setEditing(null);
          }}
          onDelete={() => {
            setDraft({
              ...draft,
              blocks: draft.blocks.filter(
                (_, index) => index !== editing.index,
              ),
            });
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        pending={pending}
        title="Delete this day template?"
        description="Plans already added to your calendar will stay."
        keepLabel="Keep template"
        confirmLabel="Delete template"
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
