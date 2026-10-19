import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { Select } from "../../../components/ui/select";
import { DatePicker } from "../../../components/ui/date-picker";
import { trackingApi } from "../../time-tracking/api";
import type { Activity, TimeSession } from "../../time-tracking/types";
import { wallTime, zonedParts } from "../dates";
import { TimeField } from "./time-field";

export function SessionEditor({
  session,
  activities,
  timezone,
  onClose,
}: {
  session: TimeSession;
  activities: Activity[];
  timezone: string;
  onClose: () => void;
}) {
  const [start, setStart] = useState(() =>
    zonedParts(session.started_at, timezone),
  );
  const [end, setEnd] = useState(() => zonedParts(session.ended_at!, timezone));
  const [activity, setActivity] = useState(session.activity_id);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (remove: boolean) => {
      if (remove) await trackingApi.removeSession(session);
      else
        await trackingApi.updateSession({
          ...session,
          activity_id: activity,
          started_at: wallTime(start.date, start.minute, timezone),
          ended_at: wallTime(end.date, end.minute, timezone),
        });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      toast.success("Session saved");
      onClose();
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit session"
      description={`Correct recorded time in ${timezone}.`}
      className="schedule-plan-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(false);
        }}
      >
        <div className="schedule-field">
          <span className="field-caption">Activity</span>
          <Select
            label="Activity"
            value={activity}
            options={activities.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={setActivity}
          />
        </div>
        <div className="schedule-field">
          <span className="field-caption">Start date</span>
          <DatePicker
            label="Session start date"
            value={start.date}
            onChange={(date) => setStart({ ...start, date })}
          />
        </div>
        <TimeField
          label="Start time"
          value={start.minute}
          onChange={(minute) => setStart({ ...start, minute })}
        />
        <div className="schedule-field">
          <span className="field-caption">End date</span>
          <DatePicker
            label="Session end date"
            value={end.date}
            onChange={(date) => setEnd({ ...end, date })}
          />
        </div>
        <TimeField
          label="End time"
          value={end.minute}
          onChange={(minute) => setEnd({ ...end, minute })}
        />
        {mutation.error && (
          <Notice tone="error">{mutation.error.message}</Notice>
        )}
        <div className="dialog-actions">
          <Button
            variant="ghost"
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              if (confirm("Delete this recorded session?"))
                mutation.mutate(true);
            }}
          >
            <Trash2 size={14} />
            Delete
          </Button>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
