import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "../../../components/ui/button";
import { DatePicker } from "../../../components/ui/date-picker";
import { Modal } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { isMobileLayout } from "../../../lib/layout";
import { PlanQuickFields } from "../../schedule/components/plan-quick-fields";
import type { Activity } from "../../time-tracking/types";
import type { PreviewPlan } from "./types";

export function ProposalEditor({
  plan,
  anchor,
  activities,
  onSave,
  onClose,
}: {
  plan: PreviewPlan;
  anchor: DOMRect;
  activities: Activity[];
  onSave: (plan: PreviewPlan) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(plan);
  const virtual = useRef({ getBoundingClientRect: () => anchor });
  const valid = fields.title.trim() && fields.end_minute > fields.start_minute;
  const content = (
    <form
      className="plan-card-form calendar-ai-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) {
          onSave(fields);
          onClose();
        }
      }}
    >
      <small className="calendar-ai-editor-label">
        Suggested plan · not added yet
      </small>
      <PlanQuickFields
        fields={fields}
        activities={activities}
        onChange={(values) => setFields({ ...fields, ...values })}
      />
      <DatePicker
        value={fields.date}
        label="Suggested plan date"
        onChange={(date) => setFields({ ...fields, date })}
      />
      <Select
        label="Suggested plan notification"
        value={
          !fields.notifications_enabled
            ? "off"
            : fields.notification_minutes === null
              ? "default"
              : String(fields.notification_minutes)
        }
        options={[
          { value: "default", label: "Notification default" },
          { value: "10", label: "10 minutes before" },
          { value: "5", label: "5 minutes before" },
          { value: "1", label: "1 minute before" },
          { value: "0", label: "At the start" },
          { value: "off", label: "No notification" },
        ]}
        onChange={(value) =>
          setFields({
            ...fields,
            notifications_enabled: value !== "off",
            notification_minutes: ["off", "default"].includes(value)
              ? null
              : (Number(value) as 0 | 1 | 5 | 10),
          })
        }
      />
      <footer>
        <Button type="button" variant="ghost" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="small" disabled={!valid}>
          Keep changes
        </Button>
      </footer>
    </form>
  );
  if (isMobileLayout())
    return (
      <Modal
        open
        onOpenChange={(open) => !open && onClose()}
        className="plan-sheet"
        title="Edit suggestion"
        description="Review this plan before adding it."
      >
        {content}
      </Modal>
    );
  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Anchor virtualRef={virtual} />
      <Popover.Portal>
        <Popover.Content
          className="plan-card"
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={14}
          aria-label="Edit suggestion"
        >
          {content}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
