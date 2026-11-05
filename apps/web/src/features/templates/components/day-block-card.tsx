import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { isMobileLayout } from "../../../lib/layout";
import type { Activity } from "../../time-tracking/types";
import type { PlanAnchor } from "../../schedule/components/plan-card";
import { PlanQuickFields } from "../../schedule/components/plan-quick-fields";
import type { DayBlock } from "../types";

export interface EditingBlock {
  index: number | null;
  block: DayBlock;
  anchor: PlanAnchor;
}

export function DayBlockCard({
  editing,
  activities,
  onSave,
  onDelete,
  onClose,
}: {
  editing: EditingBlock;
  activities: Activity[];
  onSave: (block: DayBlock) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [block, setBlock] = useState(editing.block);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const virtual = {
    current: {
      getBoundingClientRect: () =>
        DOMRect.fromRect({
          x: editing.anchor.left,
          y: editing.anchor.top,
          width: editing.anchor.right - editing.anchor.left,
          height: editing.anchor.bottom - editing.anchor.top,
        }),
    },
  };
  const content = (
    <form
      className="plan-card-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (block.end_minute <= block.start_minute) {
          setError("End time must follow start time.");
          return;
        }
        onSave(block);
      }}
    >
      <PlanQuickFields
        fields={block}
        activities={activities}
        onChange={(value) => setBlock({ ...block, ...value })}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="plan-card-actions">
        {editing.index !== null && (
          <button
            type="button"
            className="icon-button"
            aria-label="Delete template block"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
        <span className="plan-card-spacer" />
        <Button type="button" size="small" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="small">
          {editing.index === null ? "Add" : "Save"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this block?"
        description="The block will be removed when you save the template."
        keepLabel="Keep block"
        confirmLabel="Delete block"
        onClose={() => setConfirming(false)}
        onConfirm={onDelete}
      />
    </form>
  );
  if (isMobileLayout())
    return (
      <Modal
        open
        title={
          editing.index === null ? "New template block" : "Edit template block"
        }
        description="Template blocks do not start the tracker."
        className="plan-sheet"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        {content}
      </Modal>
    );
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open && !confirming) onClose();
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
          aria-label="Edit template block"
          onInteractOutside={(event) => {
            if (confirming) event.preventDefault();
          }}
        >
          {content}
          <Popover.Arrow className="plan-card-arrow" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
