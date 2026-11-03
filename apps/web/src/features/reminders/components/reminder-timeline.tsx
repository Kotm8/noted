import { useRef, type KeyboardEvent, type PointerEvent } from "react";

const SPAN = 24 * 60;
const STEP = 15;

const clock = (date: Date) =>
  date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

/** Minutes from `from` to the next local wall-clock time `hour`:00. */
function untilHour(from: Date, hour: number) {
  const target = new Date(from);
  target.setHours(hour, 0, 0, 0);
  if (target <= from) target.setDate(target.getDate() + 1);
  return (target.getTime() - from.getTime()) / 60000;
}

/**
 * The next 24 hours as one track, in 15-minute steps, with night (23:00–07:00) shaded.
 * Arrow keys move by 15 minutes and Shift+arrow by an hour. A time beyond the track,
 * chosen with Other date, pins the handle to the end.
 */
export function ReminderTimeline({
  from,
  value,
  onChange,
}: {
  from: Date;
  value: Date;
  onChange: (value: Date) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const offset = (value.getTime() - from.getTime()) / 60000;
  const beyond = offset > SPAN;
  const percent = `${(Math.min(Math.max(offset, 0), SPAN) / SPAN) * 100}%`;
  const at = (minutes: number) =>
    new Date(from.getTime() + Math.min(SPAN, Math.max(STEP, minutes)) * 60000);
  const snap = (minutes: number) => {
    const date = at(minutes);
    date.setMinutes(Math.round(date.getMinutes() / STEP) * STEP, 0, 0);
    return date.getTime() <= from.getTime() ? at(STEP) : date;
  };
  function move(event: PointerEvent<HTMLDivElement>) {
    const box = track.current!.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width),
    );
    onChange(snap(ratio * SPAN));
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step =
      (event.shiftKey ? 60 : STEP) * (event.key === "ArrowRight" ? 1 : -1);
    onChange(snap(Math.min(offset, SPAN) + step));
  }
  const nightStart = untilHour(from, 23);
  const nightEnd = untilHour(from, 7);
  const nights =
    nightEnd < nightStart
      ? [
          [0, nightEnd],
          [nightStart, SPAN],
        ]
      : [[nightStart, Math.min(nightEnd, SPAN)]];
  const marks = [6, 12, 18, 0]
    .map((hour) => untilHour(from, hour))
    .filter((minutes) => minutes > 90 && minutes < SPAN - 60)
    .sort((a, b) => a - b);
  return (
    <div
      ref={track}
      className={`reminder-timeline${beyond ? " beyond" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label="Reminder time"
      aria-valuemin={0}
      aria-valuemax={SPAN}
      aria-valuenow={Math.round(Math.min(offset, SPAN))}
      aria-valuetext={value.toLocaleString([], {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
      }}
      onKeyDown={key}
    >
      <span className="reminder-timeline-bar" />
      {nights.map(([start, end]) => (
        <span
          key={start}
          className="reminder-timeline-night"
          style={{
            left: `${(start / SPAN) * 100}%`,
            width: `${((end - start) / SPAN) * 100}%`,
          }}
        />
      ))}
      <span className="reminder-timeline-fill" style={{ width: percent }} />
      <span className="reminder-timeline-handle" style={{ left: percent }} />
      <span className="reminder-timeline-labels" aria-hidden="true">
        <span style={{ left: 0 }}>now</span>
        {marks.map((minutes) => (
          <span key={minutes} style={{ left: `${(minutes / SPAN) * 100}%` }}>
            {clock(new Date(from.getTime() + minutes * 60000))}
          </span>
        ))}
      </span>
    </div>
  );
}
