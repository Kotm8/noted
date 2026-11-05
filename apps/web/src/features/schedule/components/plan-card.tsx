import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { isMobileLayout } from "../../../lib/layout";
import type { Activity } from "../../time-tracking/types";
import type { PlanFields, PlanOccurrence } from "../types";
import type { ScheduleWrites } from "../use-schedule-writes";
import { planTitle } from "../plan-title";
import { PlanQuickFields } from "./plan-quick-fields";

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
  writes,
  onMore,
  onDraft,
  onClose,
}: {
  initial: PlanFields | PlanOccurrence;
  anchor: PlanAnchor;
  activities: Activity[];
  writes: ScheduleWrites;
  onMore: (fields: PlanFields, deleting?: boolean) => void;
  /** Follows the fields of a new plan, so the calendar can show it before it's saved. */
  onDraft?: (fields: PlanFields) => void;
  onClose: () => void;
}) {
  const existing = "id" in initial ? initial : null;
  const [fields, setFields] = useState<PlanFields>({ ...initial });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!existing) onDraft?.(fields);
  }, [existing, fields, onDraft]);
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
  function save() {
    try {
      writes.save(
        { ...fields, title: planTitle(fields, activities) },
        existing ?? undefined,
      );
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  const content = (
    <form
      className="plan-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <PlanQuickFields
        fields={fields}
        activities={activities}
        onChange={(value) => setFields((current) => ({ ...current, ...value }))}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="plan-card-actions">
        {existing && (
          <button
            type="button"
            className="icon-button"
            aria-label="Delete plan"
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
        <Button type="submit" size="small">
          {existing ? "Save" : "Add"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        pending={false}
        title="Delete this plan?"
        description="This one-off plan will be removed from your calendar."
        keepLabel="Keep plan"
        confirmLabel="Delete plan"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          writes.remove(existing!);
          onClose();
        }}
      />
    </form>
  );

  if (isMobileLayout())
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) onClose();
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
        if (!open && !confirmDelete) onClose();
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
