import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { duration, minuteLabel, stepTime } from "../dates";
import { TimeField } from "./time-field";

const STEP = 15;
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];
const DAY = 1440;
const percent = (minute: number) => `${(minute / DAY) * 100}%`;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
type Edge = "start" | "end";

/**
 * A plan's start and end on one 24-hour track. Changing the start keeps the
 * length, like moving the plan; changing the end only changes the length.
 */
export function TimeRange({
  start,
  end,
  hours,
  onChange,
}: {
  start: number;
  end: number;
  hours: { start_minute: number; end_minute: number };
  onChange: (start: number, end: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const length = end - start;
  const valid = length > 0;
  const span = valid ? length : 60;

  function moveTo(next: number) {
    const first = clamp(next, 0, DAY - STEP);
    onChange(first, clamp(first + span, first + STEP, DAY));
  }
  function resize(edge: Edge, minute: number) {
    if (edge === "start") onChange(clamp(minute, 0, end - STEP), end);
    else onChange(start, clamp(minute, start + STEP, DAY));
  }
  function minuteAt(x: number) {
    const box = track.current!.getBoundingClientRect();
    const share = clamp((x - box.left) / box.width, 0, 1);
    return Math.round((share * DAY) / STEP) * STEP;
  }
  function drag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-edge]");
    const edge = handle?.dataset.edge as Edge | undefined;
    const origin = minuteAt(event.clientX);
    let first = start;
    if (!handle && !target.closest(".time-range-bar")) {
      first = clamp(
        Math.round((origin - span / 2) / STEP) * STEP,
        0,
        DAY - span,
      );
      onChange(first, first + span);
    }
    handle?.focus({ focusVisible: false });
    const node = event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => {
      const minute = minuteAt(moved.clientX);
      if (edge) resize(edge, minute);
      else {
        const next = clamp(first + minute - origin, 0, DAY - span);
        onChange(next, next + span);
      }
    };
    const stop = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", stop);
      node.removeEventListener("pointercancel", stop);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", stop);
    node.addEventListener("pointercancel", stop);
  }
  function nudge(edge: Edge, event: KeyboardEvent) {
    const direction = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    }[event.key] as 1 | -1 | undefined;
    if (!direction) return;
    event.preventDefault();
    const size = event.shiftKey ? 60 : STEP;
    resize(edge, stepTime(edge === "start" ? start : end, direction, size));
  }

  return (
    <div className="time-range">
      <div className="schedule-time-fields">
        <TimeField label="From" value={start} onChange={moveTo} />
        <TimeField
          label="Until"
          value={end}
          end
          onChange={(value) => onChange(start, value)}
        />
      </div>
      <div className="time-range-lengths" role="group" aria-label="Length">
        {LENGTHS.map((minutes) => (
          <button
            type="button"
            key={minutes}
            aria-pressed={length === minutes}
            onClick={() => onChange(start, Math.min(DAY, start + minutes))}
          >
            {duration(minutes * 60)}
          </button>
        ))}
      </div>
      <div
        ref={track}
        className="time-range-track"
        aria-label="Day timeline"
        onPointerDown={drag}
      >
        <div
          className="time-range-hours"
          style={{
            left: percent(hours.start_minute),
            width: percent(hours.end_minute - hours.start_minute),
          }}
        />
        {Array.from({ length: 23 }, (_, index) => (
          <i
            key={index}
            className={(index + 1) % 3 ? "" : "major"}
            style={{ left: percent((index + 1) * 60) }}
          />
        ))}
        {valid && (
          <div
            className="time-range-bar"
            style={{ left: percent(start), width: percent(length) }}
          >
            {(["start", "end"] as const).map((edge) => {
              const value = edge === "start" ? start : end;
              return (
                <span
                  key={edge}
                  data-edge={edge}
                  role="slider"
                  tabIndex={0}
                  aria-label={edge === "start" ? "Plan start" : "Plan end"}
                  aria-valuemin={0}
                  aria-valuemax={DAY}
                  aria-valuenow={value}
                  aria-valuetext={minuteLabel(value)}
                  onKeyDown={(event) => nudge(edge, event)}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className="time-range-labels" aria-hidden="true">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
          <span key={hour} style={{ left: percent(hour * 60) }}>
            {String(hour).padStart(2, "0")}
          </span>
        ))}
      </div>
      <p
        className={valid ? "time-range-summary" : "time-range-summary error"}
        role="status"
      >
        {valid
          ? `${minuteLabel(start)} → ${minuteLabel(end)} · ${duration(length * 60)}`
          : "End must be after start"}
      </p>
    </div>
  );
}
