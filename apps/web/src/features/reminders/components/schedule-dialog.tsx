import { useRef, useState } from "react";
import { Bell, Repeat2, Zap } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import { localDateTime } from "../../../lib/format";
import { Select } from "../../../components/ui/select";
import type { ReminderSchedule, RepeatRule } from "../types";
import { ReminderTimeline } from "./reminder-timeline";

const repeatOptions = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
];

function atHour(from: Date, hour: number, daysAhead: number) {
  const date = new Date(from);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/** Today, Tomorrow or the weekday, then the time: "Today 15:20". */
function dayAndTime(date: Date, from: Date) {
  const days = Math.round(
    (atHour(date, 12, 0).getTime() - atHour(from, 12, 0).getTime()) / 86400000,
  );
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Tomorrow"
        : date.toLocaleDateString([], {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
  return `${day} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

function relative(date: Date, from: Date) {
  const minutes = Math.max(
    1,
    Math.round((date.getTime() - from.getTime()) / 60000),
  );
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `in ${Math.round(hours / 24)}d`;
}

/**
 * When a reminder rings: the chosen time large, quick choices, and a slider across the
 * next 24 hours. Other date opens the full date and time picker for anything later.
 * Urgent reminders ring even during quiet hours.
 */
export function ScheduleDialog({
  content,
  channelName,
  initial,
  delay = 60,
  pending,
  onClose,
  onConfirm,
}: {
  content: string;
  channelName: string;
  initial?: ReminderSchedule;
  delay?: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: (schedule: ReminderSchedule) => Promise<void>;
}) {
  const [from] = useState(() => new Date());
  const [due, setDue] = useState(() =>
    initial
      ? new Date(initial.due_at)
      : new Date(from.getTime() + delay * 60000),
  );
  const [other, setOther] = useState(
    () => due.getTime() - from.getTime() > 24 * 3600000,
  );
  const [urgent, setUrgent] = useState(initial?.urgent ?? false);
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [error, setError] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const choices = [
    { label: "In 1 hour", at: new Date(from.getTime() + 3600000) },
    { label: "In 3 hours", at: new Date(from.getTime() + 3 * 3600000) },
    ...(from.getHours() < 18
      ? [{ label: "This evening", at: atHour(from, 19, 0) }]
      : []),
    { label: "Tomorrow morning", at: atHour(from, 9, 1) },
  ];
  function choose(date: Date) {
    setDue(date);
    setError("");
  }
  async function submit() {
    if (pending || sending.current) return;
    if (!Number.isFinite(due.getTime()) || due.getTime() <= Date.now()) {
      setError("Choose a reminder time in the future.");
      return;
    }
    sending.current = true;
    try {
      await onConfirm({ due_at: due.toISOString(), repeat, timezone, urgent });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save this reminder.",
      );
    } finally {
      sending.current = false;
    }
  }
  return (
    <Modal
      open
      title="Remind me"
      description={`#${channelName}`}
      onOpenChange={(open) => {
        if (!open && !pending && !sending.current) onClose();
      }}
      className="schedule-dialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        confirm.current?.focus();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.repeat || event.nativeEvent.isComposing)
          )
            event.preventDefault();
        }}
      >
        <p className="reminder-context">{content || "Attached files"}</p>
        <div className="reminder-when" role="status">
          <strong>{dayAndTime(due, from)}</strong>
          <span>{relative(due, from)}</span>
        </div>
        <div
          className="reminder-choices"
          role="group"
          aria-label="Quick choices"
        >
          {choices.map((choice) => (
            <button
              type="button"
              key={choice.label}
              aria-pressed={!other && due.getTime() === choice.at.getTime()}
              onClick={() => {
                setOther(false);
                choose(choice.at);
                confirm.current?.focus();
              }}
            >
              {choice.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={other}
            onClick={() => setOther(!other)}
          >
            Other date…
          </button>
        </div>
        {other ? (
          <DateTimePicker
            value={localDateTime(due)}
            onChange={(value) => choose(new Date(value))}
          />
        ) : (
          <ReminderTimeline from={from} value={due} onChange={choose} />
        )}
        <label className="reminder-urgent">
          <Zap size={15} />
          <span>
            <strong>Urgent</strong>
            Rings even during quiet hours
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={urgent}
            onChange={(event) => setUrgent(event.target.checked)}
          />
        </label>
        <div className="reminder-repeat">
          <span>
            <Repeat2 size={15} />
            Repeat
          </span>
          <Select
            label="Repeat"
            value={repeat}
            options={repeatOptions}
            onChange={(value) => setRepeat(value as RepeatRule)}
          />
        </div>
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
          <Button ref={confirm} type="submit" disabled={pending}>
            <Bell size={20} />
            {initial ? "Save time" : "Send reminder"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
