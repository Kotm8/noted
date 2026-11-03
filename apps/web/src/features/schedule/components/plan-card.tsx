import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { isMobileLayout } from "../../../lib/layout";
import type { Activity } from "../../time-tracking/types";
import { scheduleApi } from "../api";
import { duration } from "../dates";
import type { PlanFields, PlanOccurrence } from "../types";
import type { ScheduleHistory } from "../use-schedule-history";
import { planTitle } from "../plan-title";
import { TimeField } from "./time-field";

export interface PlanAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The quick editor attached to a calendar block: title, activity and times. Repeats,
 * notifications and the date live in the full form behind More options. Phones get the
 * same fields as a bottom sheet.
 */
export function PlanCard({
  initial,
  anchor,
  activities,
  history,
  onMore,
  onDraft,
  onClose,
}: {
  initial: PlanFields | PlanOccurrence;
  anchor: PlanAnchor;
  activities: Activity[];
  history: ScheduleHistory;
  onMore: (fields: PlanFields, deleting?: boolean) => void;
  /** Follows the fields of a new plan, so the calendar can show it before it's saved. */
  onDraft?: (fields: PlanFields) => void;
  onClose: () => void;
}) {
  const existing = "id" in initial ? initial : null;
  const [fields, setFields] = useState<PlanFields>({ ...initial });
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!existing) onDraft?.(fields);
  }, [existing, fields, onDraft]);
  const client = useQueryClient();
  const virtual = useRef({
    getBoundingClientRect: () =>
      (!existing &&
        document.querySelector("[data-draft]")?.getBoundingClientRect()) ||
      DOMRect.fromRect({
        x: anchor.left,
        y: anchor.top,
        width: anchor.right - anchor.left,
        height: anchor.bottom - anchor.top,
      }),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (fields.end_minute <= fields.start_minute)
        throw new Error("End time must follow start time.");
      const values = { ...fields, title: planTitle(fields, activities) };
      return existing
        ? scheduleApi.update(existing.id, {
            ...values,
            revision: existing.revision,
            scope: existing.frequency === "none" ? "series" : "occurrence",
            occurrence_date: existing.occurrence_date,
          })
        : scheduleApi.create(values);
    },
    onSuccess: (plan) => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      if (existing) toast.success("Plan saved");
      else {
        history.created(plan);
        toast.success("Plan added", history.undoToast());
      }
      onClose();
    },
    onError: () => void client.invalidateQueries({ queryKey: ["schedule"] }),
  });
  const remove = useMutation({
    mutationFn: () => scheduleApi.remove(existing!.id, existing!.revision),
    onSuccess: (plan) => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      history.deleted(existing!, plan, false);
      onClose();
      toast.success("Plan deleted", history.undoToast());
    },
  });
  const pending = save.isPending || remove.isPending;
  const choices = activities.filter(
    (item) => !item.archived || item.id === fields.activity_id,
  );
  const length = fields.end_minute - fields.start_minute;

  const content = (
    <form
      className="plan-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) save.mutate();
      }}
    >
      <input
        className="plan-card-title"
        aria-label="Title"
        value={fields.title}
        maxLength={120}
        autoFocus
        placeholder={planTitle({ ...fields, title: "" }, activities)}
        onChange={(event) =>
          setFields((current) => ({ ...current, title: event.target.value }))
        }
      />
      <div className="plan-card-activities" role="group" aria-label="Activity">
        {choices.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === fields.activity_id}
            style={{ "--activity": item.color } as CSSProperties}
            onClick={() =>
              setFields((current) => ({ ...current, activity_id: item.id }))
            }
          >
            <i aria-hidden="true" />
            {item.name}
          </button>
        ))}
      </div>
      <div className="plan-card-times">
        <TimeField
          label="Start"
          value={fields.start_minute}
          onChange={(start) =>
            setFields((current) => ({
              ...current,
              start_minute: start,
              end_minute: Math.min(
                1440,
                start + (current.end_minute - current.start_minute),
              ),
            }))
          }
        />
        <ArrowRight size={14} aria-hidden="true" />
        <TimeField
          label="End"
          end
          value={fields.end_minute}
          onChange={(end) =>
            setFields((current) => ({ ...current, end_minute: end }))
          }
        />
        <span className="plan-card-length">
          {length > 0 ? duration(length * 60) : "—"}
        </span>
      </div>
      {(save.error || remove.error) && (
        <Notice tone="error">{(save.error ?? remove.error)?.message}</Notice>
      )}
      <div className="plan-card-actions">
        {existing && (
          <button
            type="button"
            className="icon-button"
            aria-label="Delete plan"
            disabled={pending}
            onClick={() =>
              existing.frequency === "none"
                ? setConfirmDelete(true)
                : onMore(fields, true)
            }
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          type="button"
          className="plan-card-more"
          onClick={() => onMore(fields)}
        >
          More options
        </button>
        <span className="plan-card-spacer" />
        <Button type="button" variant="ghost" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="small" disabled={pending}>
          {save.isPending ? "Saving…" : existing ? "Save" : "Add"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        pending={remove.isPending}
        title="Delete this plan?"
        description="This one-off plan will be removed from your calendar."
        keepLabel="Keep plan"
        confirmLabel="Delete plan"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </form>
  );

  if (isMobileLayout())
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !pending) onClose();
        }}
        title={existing ? "Edit plan" : "New plan"}
        description="Planning never starts your timer."
        className="plan-sheet"
      >
        {content}
      </Modal>
    );
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending && !confirmDelete) onClose();
      }}
    >
      <Popover.Anchor virtualRef={virtual} />
      <Popover.Portal>
        <Popover.Content
          className="plan-card"
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          aria-label={existing ? "Edit plan" : "New plan"}
          onInteractOutside={(event) => {
            // The delete confirmation, and focus returning from it, stay part of the card.
            const target = event.target;
            if (
              confirmDelete ||
              (target instanceof Element && target.closest('[role="dialog"]'))
            )
              event.preventDefault();
          }}
        >
          {content}
          <Popover.Arrow className="plan-card-arrow" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
