import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Repeat2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { DatePicker } from "../../../components/ui/date-picker";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import type { Activity } from "../../time-tracking/types";
import { scheduleApi } from "../api";
import type { Frequency, PlanFields, PlanOccurrence } from "../types";
import { TimeField } from "./time-field";
import { PromptHistory } from "./prompt-history";

export function PlanDialog({
  initial,
  activities,
  onClose,
}: {
  initial: PlanFields | PlanOccurrence;
  activities: Activity[];
  onClose: () => void;
}) {
  const existing = "id" in initial ? initial : null;
  const [fields, setFields] = useState<PlanFields>({ ...initial });
  const [scope, setScope] = useState<"series" | "occurrence">(
    existing?.frequency !== "none" && existing ? "occurrence" : "series",
  );
  const client = useQueryClient();
  const source = useQuery({
    queryKey: ["schedule-plan", existing?.id],
    queryFn: () => scheduleApi.get(existing!.id),
    enabled: Boolean(existing),
  });
  const [deleteScope, setDeleteScope] = useState(false);
  function change<K extends keyof PlanFields>(key: K, value: PlanFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  const save = useMutation({
    mutationFn: async () => {
      if (!fields.title.trim()) throw new Error("Give the plan a title.");
      if (fields.end_minute <= fields.start_minute)
        throw new Error("End time must follow start time.");
      return existing
        ? scheduleApi.update(existing.id, {
            ...fields,
            revision: existing.revision,
            scope,
            occurrence_date: existing.occurrence_date,
          })
        : scheduleApi.create(fields);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      toast.success("Plan saved");
      onClose();
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
    },
  });
  const remove = useMutation({
    mutationFn: (occurrence: boolean) =>
      scheduleApi.remove(
        existing!.id,
        existing!.revision,
        occurrence ? existing!.occurrence_date : undefined,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["schedule"] });
      onClose();
      toast.success("Plan deleted");
    },
  });
  const locked = Boolean(
    existing && existing.frequency !== "none" && scope === "occurrence",
  );
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending && !remove.isPending) onClose();
      }}
      title={existing ? "Edit plan" : "New plan"}
      description="Plans appear above tracked time. Planning never starts your timer."
      className="schedule-plan-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {existing && existing.frequency !== "none" && (
          <div className="schedule-field">
            <span className="field-caption">Apply changes to</span>
            <Select
              label="Apply changes to"
              value={scope}
              options={[
                { value: "occurrence", label: "Only this occurrence" },
                { value: "series", label: "Entire series" },
              ]}
              onChange={(next) => {
                setScope(next as typeof scope);
                if (next === "series" && source.data)
                  change("date", source.data.date);
                else change("date", existing.date);
              }}
            />
            {scope === "series" && (
              <p className="schedule-help">
                <Info size={14} />
                This updates the whole series and resets individually edited
                dates.
              </p>
            )}
          </div>
        )}
        <label>
          Title
          <input
            value={fields.title}
            onChange={(event) => change("title", event.target.value)}
            required
            maxLength={120}
            autoFocus
            placeholder="What’s the plan?"
          />
        </label>
        <div className="schedule-field">
          <span className="field-caption">Activity</span>
          <Select
            label="Activity"
            value={fields.activity_id}
            options={activities
              .filter(
                (item) => !item.archived || item.id === fields.activity_id,
              )
              .map((item) => ({ value: item.id, label: item.name }))}
            onChange={(value) => change("activity_id", value)}
          />
        </div>
        <div className="schedule-field">
          <span className="field-caption">Date</span>
          <DatePicker
            label="Plan date"
            value={fields.date}
            onChange={(value) => change("date", value)}
          />
        </div>
        <div className="schedule-time-fields">
          <TimeField
            label="From"
            value={fields.start_minute}
            onChange={(value) => change("start_minute", value)}
          />
          <TimeField
            label="Until"
            value={fields.end_minute}
            onChange={(value) => change("end_minute", value)}
            end
          />
        </div>
        <div className="schedule-field">
          <span className="field-caption">Activity notification</span>
          <Select
            label="Activity notification"
            value={
              fields.notifications_enabled === false
                ? "off"
                : fields.notification_minutes == null
                  ? "default"
                  : String(fields.notification_minutes)
            }
            options={[
              { value: "default", label: "Use notification setting" },
              { value: "10", label: "10 minutes before" },
              { value: "5", label: "5 minutes before" },
              { value: "1", label: "1 minute before" },
              { value: "0", label: "At the start" },
              { value: "off", label: "Off" },
            ]}
            onChange={(value) => {
              change("notifications_enabled", value !== "off");
              change(
                "notification_minutes",
                value === "default" || value === "off"
                  ? null
                  : (Number(value) as 0 | 1 | 5 | 10),
              );
            }}
          />
        </div>
        <fieldset disabled={locked} className="schedule-repeat-fields">
          <div className="schedule-field">
            <span className="field-caption">Repeat</span>
            <Select
              label="Repeat"
              value={fields.frequency}
              options={[
                { value: "none", label: "Does not repeat" },
                { value: "daily", label: "Every day" },
                { value: "weekly", label: "Every week" },
                { value: "biweekly", label: "Every 2 weeks" },
                { value: "monthly", label: "Every month" },
              ]}
              onChange={(value) => change("frequency", value as Frequency)}
            />
          </div>
          {["weekly", "biweekly"].includes(fields.frequency) && (
            <div
              className="schedule-weekdays"
              role="group"
              aria-label="Repeat on weekdays"
            >
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (name, day) => (
                  <button
                    type="button"
                    key={name}
                    disabled={locked}
                    aria-pressed={fields.weekdays.includes(day)}
                    onClick={() =>
                      change(
                        "weekdays",
                        fields.weekdays.includes(day)
                          ? fields.weekdays.filter((value) => value !== day)
                          : [...fields.weekdays, day].sort(),
                      )
                    }
                  >
                    {name}
                  </button>
                ),
              )}
            </div>
          )}
          {fields.frequency !== "none" && (
            <div className="schedule-field">
              <span className="field-caption">Repeat until · optional</span>
              <DatePicker
                label="Repeat until"
                optional
                value={fields.repeat_until ?? ""}
                onChange={(value) => change("repeat_until", value || null)}
              />
            </div>
          )}
        </fieldset>
        {locked && (
          <p className="schedule-help">
            <Repeat2 size={14} />
            Choose Entire series to change the repeat pattern.
          </p>
        )}
        {fields.frequency === "monthly" && (
          <p className="schedule-help">
            Repeats on day {Number(fields.date.slice(8))} of each month. Months
            without that day are skipped.
          </p>
        )}
        <p className="schedule-help">Times use {fields.timezone}.</p>
        {existing && <PromptHistory planId={existing.id} />}
        {(save.error || remove.error) && (
          <Notice tone="error">
            {(save.error ?? remove.error)?.message} Your changes have been kept.
          </Notice>
        )}
        {deleteScope && (
          <div className="schedule-delete-scope">
            <p>Delete only this occurrence or the entire series?</p>
            <Button
              type="button"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(true)}
            >
              Only this occurrence
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(false)}
            >
              Entire series
            </Button>
          </div>
        )}
        <div className="dialog-actions">
          {existing && (
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending || remove.isPending}
              onClick={() => {
                if (existing.frequency !== "none") setDeleteScope(!deleteScope);
                else if (confirm("Delete this one-off plan?"))
                  remove.mutate(false);
              }}
            >
              <Trash2 size={14} />
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || remove.isPending}>
            {save.isPending
              ? "Saving…"
              : existing
                ? "Save changes"
                : "Add plan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
