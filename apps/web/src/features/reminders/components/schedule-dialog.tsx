import { useRef, useState } from "react";
import { Bell, CalendarDays, Clock3, Repeat2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { DateTimePicker } from "../../../components/ui/date-time-picker";
import { localDateTime } from "../../../lib/format";
import { Select } from "../../../components/ui/select";
import type { ReminderSchedule, RepeatRule } from "../types";

const repeatOptions = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
];

export function ScheduleDialog({
  content,
  channelName,
  initial,
  delay = 10,
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
  const [choice, setChoice] = useState(initial ? "custom" : "delay");
  const [minutes, setMinutes] = useState(delay);
  const [exact, setExact] = useState(
    localDateTime(
      initial ? new Date(initial.due_at) : new Date(Date.now() + 3600000),
    ),
  );
  const [repeat, setRepeat] = useState<RepeatRule>(initial?.repeat ?? "none");
  const [error, setError] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  function tomorrow() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date;
  }
  const due =
    choice === "delay"
      ? new Date(Date.now() + minutes * 60000)
      : new Date(exact);
  async function submit() {
    if (pending || sending.current) return;
    const selectedTime =
      choice === "delay"
        ? new Date(Date.now() + minutes * 60000)
        : new Date(exact);
    if (
      !Number.isFinite(selectedTime.getTime()) ||
      selectedTime.getTime() <= Date.now()
    ) {
      setError("Choose a reminder time in the future.");
      return;
    }
    sending.current = true;
    try {
      await onConfirm({ due_at: selectedTime.toISOString(), repeat, timezone });
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
      title="When should we remind you?"
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
        <div className="schedule-choices">
          {[
            { label: "In 10 minutes", minutes: 10 },
            { label: "In 1 hour", minutes: 60 },
            { label: "Tomorrow morning", minutes: 0 },
          ].map((option) => (
            <button
              type="button"
              key={option.label}
              aria-pressed={
                option.minutes
                  ? choice === "delay" && minutes === option.minutes
                  : choice === "tomorrow"
              }
              onClick={() => {
                if (option.minutes) {
                  setChoice("delay");
                  setMinutes(option.minutes);
                } else {
                  setChoice("tomorrow");
                  setExact(localDateTime(tomorrow()));
                }
                setError("");
                confirm.current?.focus();
              }}
            >
              <Clock3 size={16} />
              <span>{option.label}</span>
              <time>
                {(option.minutes
                  ? new Date(Date.now() + option.minutes * 60000)
                  : tomorrow()
                ).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </button>
          ))}
          <button
            type="button"
            aria-pressed={choice === "custom"}
            onClick={() => {
              setChoice("custom");
              setError("");
            }}
          >
            <CalendarDays size={16} />
            <span>Choose date & time</span>
            <small>Pick a date</small>
          </button>
        </div>
        {choice === "custom" && (
          <DateTimePicker
            value={exact}
            onChange={(value) => {
              setExact(value);
              setError("");
            }}
          />
        )}
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
        <p className="reminder-summary">
          {due.toLocaleString()} · {timezone}
        </p>
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
