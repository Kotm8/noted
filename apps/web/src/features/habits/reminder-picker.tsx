import { useState } from "react";
import { DateTimePicker } from "../../components/ui/date-time-picker";
import { ReminderTimeline } from "../reminders/components/reminder-timeline";
import { localDateTime } from "../../lib/format";
import { addDays, minuteLabel, zonedParts } from "../schedule/dates";

export function HabitReminderPicker({
  minute,
  start,
  timezone,
  onChange,
}: {
  minute: number;
  start: string | null;
  timezone: string;
  onChange: (minute: number, start: string) => void;
}) {
  const [from] = useState(() => {
    const parts = zonedParts(Date.now(), timezone);
    return new Date(`${parts.date}T${minuteLabel(parts.minute)}`);
  });
  const fromDay = localDateTime(from).slice(0, 10);
  const nextDay =
    minute <= from.getHours() * 60 + from.getMinutes()
      ? addDays(fromDay, 1)
      : fromDay;
  const day = start && start > nextDay ? start : nextDay;
  const value = new Date(`${day}T${minuteLabel(minute)}`);
  const [calendar, setCalendar] = useState(false);
  function choose(date: Date) {
    onChange(
      date.getHours() * 60 + date.getMinutes(),
      localDateTime(date).slice(0, 10),
    );
  }
  return (
    <div className="habit-reminder-picker">
      <div className="reminder-when">
        <strong>{minuteLabel(minute)}</strong>
        <span>{timezone}</span>
      </div>
      <div
        className="reminder-choices"
        role="group"
        aria-label="Reminder choices"
      >
        {[
          { label: "Morning", minute: 540 },
          { label: "Afternoon", minute: 840 },
          { label: "Evening", minute: 1140 },
        ].map((item) => (
          <button
            type="button"
            key={item.label}
            onClick={() => {
              onChange(item.minute, fromDay);
              setCalendar(false);
            }}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={calendar}
          onClick={() => setCalendar(!calendar)}
        >
          Other date…
        </button>
      </div>
      {calendar ? (
        <DateTimePicker
          value={localDateTime(value)}
          min={localDateTime(from)}
          onChange={(next) => choose(new Date(next))}
        />
      ) : (
        <ReminderTimeline from={from} value={value} onChange={choose} />
      )}
      <p className="habit-help">
        On selected weekdays, while this habit is unfinished.
      </p>
    </div>
  );
}
