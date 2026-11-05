import { useRef, type CSSProperties, type PointerEvent } from "react";
import { ActivityGlyphIcon } from "../../time-tracking/components/activity-icon";
import type { Activity, TrackingPreferences } from "../../time-tracking/types";
import { minuteLabel } from "../../schedule/dates";
import type { DayBlock } from "../types";
import type { EditingBlock } from "./day-block-card";

export function DayTemplateTimeline({
  blocks,
  activities,
  hours,
  onEdit,
}: {
  blocks: DayBlock[];
  activities: Activity[];
  hours: TrackingPreferences;
  onEdit: (editing: EditingBlock) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pointerType = useRef("mouse");
  const first = Math.min(
    hours.start_minute,
    ...blocks.map((block) => block.start_minute),
  );
  const last = Math.max(
    hours.end_minute,
    ...blocks.map((block) => block.end_minute),
  );
  const span = last - first;
  const endings: number[] = [];
  const positioned = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => a.block.start_minute - b.block.start_minute)
    .map((item) => {
      let row = endings.findIndex((end) => end <= item.block.start_minute);
      if (row < 0) row = endings.length;
      endings[row] = item.block.end_minute;
      return { ...item, row };
    });
  const available = activities.filter((activity) => !activity.archived);
  function add(start: number, end: number, bounds: DOMRect) {
    if (!available.length) return;
    onEdit({
      index: null,
      block: {
        title: "",
        activity_id: available[0].id,
        start_minute: start,
        end_minute: end,
      },
      anchor: {
        left: bounds.left + ((start - first) / span) * bounds.width,
        right: bounds.left + ((end - first) / span) * bounds.width,
        top: bounds.top,
        bottom: bounds.top + 50,
      },
    });
  }
  function draw(event: PointerEvent<HTMLDivElement>) {
    pointerType.current = event.pointerType;
    if (event.pointerType === "touch") return;
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button") ||
      !available.length
    )
      return;
    const node = event.currentTarget;
    const bounds = node.getBoundingClientRect();
    const at = (x: number) =>
      Math.max(
        first,
        Math.min(
          last,
          Math.round((first + ((x - bounds.left) / bounds.width) * span) / 15) *
            15,
        ),
      );
    const origin = at(event.clientX);
    const draft = document.createElement("div");
    draft.className = "day-template-draft";
    node.append(draft);
    const move = (value: globalThis.PointerEvent) => {
      const end = at(value.clientX);
      draft.style.left = `${((Math.min(origin, end) - first) / span) * 100}%`;
      draft.style.width = `${(Math.max(15, Math.abs(origin - end)) / span) * 100}%`;
    };
    const stop = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", finish);
      node.removeEventListener("pointercancel", stop);
      draft.remove();
    };
    const finish = (value: globalThis.PointerEvent) => {
      const end = at(value.clientX);
      const start = Math.min(origin, end, last - 15);
      stop();
      add(
        start,
        Math.min(
          last,
          Math.max(start + (origin === end ? 60 : 15), origin, end),
        ),
        bounds,
      );
    };
    node.setPointerCapture(event.pointerId);
    move(event.nativeEvent);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", finish);
    node.addEventListener("pointercancel", stop);
  }
  const ticks = Array.from({ length: Math.ceil(span / 120) + 1 }, (_, index) =>
    Math.min(last, first + index * 120),
  );
  return (
    <div className="day-template-scroll">
      <div
        className="day-template-board"
        style={{ "--template-hours": span / 60 } as CSSProperties}
      >
        <div className="day-template-axis">
          <span>TEMPLATE</span>
          <div>
            {ticks.map((minute) => (
              <time
                key={minute}
                style={{ left: `${((minute - first) / span) * 100}%` }}
              >
                {minuteLabel(minute)}
              </time>
            ))}
          </div>
        </div>
        <div className="day-template-row">
          <div className="day-template-label">
            A day<small>{blocks.length} blocks</small>
          </div>
          <div
            className="day-template-track"
            ref={track}
            role="group"
            tabIndex={available.length ? 0 : undefined}
            aria-label="Click or drag to add a template block"
            style={
              { "--plan-rows": Math.max(1, endings.length) } as CSSProperties
            }
            onPointerDown={draw}
            onClick={(event) => {
              if (
                pointerType.current !== "touch" ||
                (event.target as HTMLElement).closest("button")
              )
                return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const start = Math.max(
                first,
                Math.min(
                  last - 15,
                  Math.round(
                    (first +
                      ((event.clientX - bounds.left) / bounds.width) * span) /
                      15,
                  ) * 15,
                ),
              );
              add(start, Math.min(last, start + 60), bounds);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target === event.currentTarget
              ) {
                event.preventDefault();
                add(
                  first,
                  Math.min(last, first + 60),
                  event.currentTarget.getBoundingClientRect(),
                );
              }
            }}
          >
            {positioned.map(({ block, index, row }) => {
              const activity = activities.find(
                (item) => item.id === block.activity_id,
              );
              return (
                <button
                  type="button"
                  key={index}
                  className={`schedule-block ${block.end_minute - block.start_minute <= 60 ? "template-narrow-block" : ""}`}
                  style={
                    {
                      left: `${((block.start_minute - first) / span) * 100}%`,
                      width: `${((block.end_minute - block.start_minute) / span) * 100}%`,
                      top: `${row * 54}px`,
                      "--activity": activity?.color ?? "var(--accent)",
                    } as CSSProperties
                  }
                  title={`${block.title || activity?.name || "Missing activity"} · ${minuteLabel(block.start_minute)} – ${minuteLabel(block.end_minute)}`}
                  aria-label={`Edit ${block.title || activity?.name || "template block"}`}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onEdit({ index, block, anchor: rect });
                  }}
                >
                  <span className="schedule-block-title">
                    {activity && <ActivityGlyphIcon name={activity.icon} />}
                    <strong>
                      {block.title || activity?.name || "Missing activity"}
                    </strong>
                  </span>
                  <span className="schedule-block-time">
                    {minuteLabel(block.start_minute)} –{" "}
                    {minuteLabel(block.end_minute)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
