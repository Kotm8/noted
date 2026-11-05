import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { Select } from "../../components/ui/select";
import type { Activity } from "../time-tracking/types";
import type { Habit, HabitFields } from "./types";
import { habitsApi } from "./api";
import { HabitReminderPicker } from "./reminder-picker";

export function HabitEditor({
  habit,
  activities,
  timezone,
  today,
  onClose,
  onSaved,
}: {
  habit: Habit | null;
  activities: Activity[];
  timezone: string;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<HabitFields>(
    habit ?? {
      name: "",
      kind: "check",
      goal: 1,
      unit: "times",
      period: "Anytime",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      activity_id: null,
      timezone,
      starts_on: today,
      reminder_minute: null,
      reminder_start: null,
    },
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  function change(next: Partial<HabitFields>) {
    setFields((current) => ({ ...current, ...next }));
  }
  async function save() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if (habit)
        await habitsApi.update({
          ...fields,
          id: habit.id,
          revision: habit.revision,
        });
      else await habitsApi.create(fields);
      onSaved();
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      open
      title={habit ? "Edit habit" : "New habit"}
      description=""
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      className="habit-editor"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={60}
            value={fields.name}
            onChange={(event) => change({ name: event.target.value })}
            placeholder="e.g. Read"
          />
        </label>
        <fieldset disabled={pending}>
          <legend>How you track it</legend>
          <div className="habit-segments">
            {(["check", "count", "time"] as const).map((kind) => (
              <button
                type="button"
                key={kind}
                aria-pressed={fields.kind === kind}
                onClick={() =>
                  change({
                    kind,
                    goal:
                      kind === "check"
                        ? 1
                        : fields.kind === "check"
                          ? 20
                          : fields.goal,
                    unit: kind === "time" ? "min" : "times",
                    activity_id: kind === "time" ? fields.activity_id : null,
                  })
                }
              >
                {kind === "check"
                  ? "Check off"
                  : kind === "time"
                    ? "Minutes"
                    : "Amount"}
              </button>
            ))}
          </div>
        </fieldset>
        {fields.kind !== "check" && (
          <div className="habit-goal-fields">
            <label>
              Daily target
              <input
                type="number"
                required
                min="1"
                max="100000"
                step="any"
                value={fields.goal}
                onChange={(event) =>
                  change({ goal: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Unit
              <input
                required
                maxLength={20}
                readOnly={fields.kind === "time"}
                value={fields.unit}
                onChange={(event) => change({ unit: event.target.value })}
              />
            </label>
          </div>
        )}
        <label>
          Linked activity{" "}
          <Select
            label="Linked activity"
            value={fields.activity_id ?? ""}
            options={[
              { value: "", label: "None" },
              ...activities
                .filter(
                  (item) => !item.archived || item.id === fields.activity_id,
                )
                .map((item) => ({ value: item.id, label: item.name })),
            ]}
            onChange={(id) =>
              change({
                activity_id: id || null,
                ...(id
                  ? {
                      kind: "time",
                      unit: "min",
                      goal: fields.kind === "check" ? 20 : fields.goal,
                    }
                  : {}),
              })
            }
          />
        </label>
        {fields.activity_id && (
          <p className="habit-help">Tracked minutes count automatically.</p>
        )}
        <fieldset disabled={pending}>
          <legend>Repeat on</legend>
          <div className="habit-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
              (day, index) => (
                <button
                  type="button"
                  key={day}
                  aria-label={`Repeat on ${day}`}
                  aria-pressed={fields.weekdays.includes(index)}
                  onClick={() =>
                    change({
                      weekdays: fields.weekdays.includes(index)
                        ? fields.weekdays.filter((value) => value !== index)
                        : [...fields.weekdays, index].sort(),
                    })
                  }
                >
                  {day}
                </button>
              ),
            )}
          </div>
        </fieldset>
        <fieldset disabled={pending}>
          <legend>When it fits</legend>
          <div className="habit-segments">
            {(["Morning", "Anytime", "Evening"] as const).map((period) => (
              <button
                type="button"
                key={period}
                aria-pressed={fields.period === period}
                onClick={() => change({ period })}
              >
                {period}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="habit-reminder-toggle">
          <span>
            Reminder
            <small>{fields.reminder_minute === null ? "Off" : "On"}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Habit reminders"
            checked={fields.reminder_minute !== null}
            onChange={(event) =>
              change({
                reminder_minute: event.target.checked ? 540 : null,
                reminder_start: null,
              })
            }
          />
        </div>
        {fields.reminder_minute !== null && (
          <HabitReminderPicker
            minute={fields.reminder_minute}
            start={fields.reminder_start}
            timezone={fields.timezone}
            onChange={(minute, start) =>
              change({ reminder_minute: minute, reminder_start: start })
            }
          />
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            disabled={pending || !fields.weekdays.length || !fields.name.trim()}
          >
            {pending ? "Saving…" : habit ? "Save changes" : "Create habit"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
