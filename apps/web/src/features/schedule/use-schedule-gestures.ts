import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { TrackingPreferences } from "../time-tracking/types";
import { defaultPlanTimes, minuteLabel } from "./dates";

export interface DragValues {
  date: string;
  start_minute: number;
  end_minute: number;
  activity_id?: string;
  /** Screen x of a right-click, so the plan form can open beside it. */
  anchorX?: number;
}
interface Options {
  preferences: TrackingPreferences;
  pending: boolean;
  create: (values: DragValues) => void;
  change: (id: string, values: DragValues) => void;
  copy: (id: string, values: DragValues) => void;
}
interface Gesture {
  pointer: number;
  track: HTMLElement;
  source: HTMLElement | null;
  kind: string;
  x: number;
  y: number;
  downX: number;
  downY: number;
  anchor: number;
  start: number;
  end: number;
  moved: boolean;
  valid: boolean;
  copying: boolean;
  result?: DragValues;
  ghost?: HTMLElement;
}

export function useScheduleGestures(
  rootRef: RefObject<HTMLDivElement | null>,
  options: Options,
) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let gesture: Gesture | null = null;
    let cancelled: number | null = null;
    let suppressClick = false;
    let frame = 0;
    const tooltip = document.createElement("div");
    tooltip.className = "schedule-drag-tooltip";
    tooltip.hidden = true;
    document.body.append(tooltip);
    const clamp = (value: number, start: number, end: number) =>
      Math.max(start, Math.min(end, value));
    const snap = (value: number) => Math.round(value / 15) * 15;
    const minuteAt = (track: HTMLElement, x: number) => {
      const box = track.getBoundingClientRect();
      const p = latest.current.preferences;
      return (
        p.start_minute +
        ((x - box.left) / box.width) * (p.end_minute - p.start_minute)
      );
    };
    const armSuppression = () => {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    };
    function clear() {
      cancelAnimationFrame(frame);
      tooltip.hidden = true;
      gesture?.ghost?.remove();
      gesture?.source?.classList.remove("schedule-gesture-source");
      if (gesture?.track.hasPointerCapture(gesture.pointer))
        gesture.track.releasePointerCapture(gesture.pointer);
      gesture = null;
      document.body.classList.remove("schedule-dragging", "schedule-copying");
    }
    function paint() {
      if (!gesture?.moved) return;
      const g = gesture;
      const p = latest.current.preferences;
      const target =
        g.kind === "move"
          ? document
              .elementFromPoint(g.x, g.y)
              ?.closest(".schedule-dual-track")
              ?.querySelector<HTMLElement>("[data-draw]")
          : g.track;
      g.valid = Boolean(target);
      const track = target ?? g.track;
      let start = g.start;
      let end = g.end;
      if (g.kind === "create") {
        const minute = clamp(
          snap(minuteAt(track, g.x)),
          p.start_minute,
          p.end_minute,
        );
        start = Math.min(g.anchor, minute);
        end = Math.max(g.anchor, minute);
        if (end - start < 15) {
          start = clamp(start, p.start_minute, p.end_minute - 15);
          end = start + 15;
        }
      } else if (g.kind === "move") {
        const length = end - start;
        start = clamp(
          start + snap(minuteAt(track, g.x) - g.anchor),
          p.start_minute,
          p.end_minute - length,
        );
        end = start + length;
      } else if (g.kind === "start")
        start = clamp(snap(minuteAt(track, g.x)), p.start_minute, end - 15);
      else end = clamp(snap(minuteAt(track, g.x)), start + 15, p.end_minute);
      g.result = {
        date: track.dataset.date!,
        start_minute: start,
        end_minute: end,
        ...(track.dataset.activity
          ? { activity_id: track.dataset.activity }
          : {}),
      };
      g.ghost ??= Object.assign(document.createElement("div"), {
        className: "schedule-drag-ghost",
      });
      g.ghost.classList.toggle("copy", g.copying);
      g.source?.classList.toggle("schedule-gesture-source", !g.copying);
      document.body.classList.toggle("schedule-copying", g.copying);
      if (g.ghost.parentElement !== track) track.append(g.ghost);
      g.ghost.style.left = `${((start - p.start_minute) / (p.end_minute - p.start_minute)) * 100}%`;
      g.ghost.style.width = `${((end - start) / (p.end_minute - p.start_minute)) * 100}%`;
      const label = `${g.copying ? "Copy · " : ""}${minuteLabel(start)}–${minuteLabel(end)}`;
      g.ghost.textContent = label;
      tooltip.textContent = `${label} · ${end - start}m${g.valid ? "" : " · move onto a row"}`;
      tooltip.style.left = `${clamp(g.x + 14, 8, innerWidth - 245)}px`;
      tooltip.style.top = `${clamp(g.y - 38, 8, innerHeight - 45)}px`;
      tooltip.hidden = false;
    }
    function scroll() {
      if (!gesture?.moved) return;
      const scroller = gesture.track.closest<HTMLElement>(
        ".schedule-timeline-scroll",
      )!;
      const box = scroller.getBoundingClientRect();
      if (gesture.x > box.right - 30 && gesture.x < box.right + 10)
        scroller.scrollLeft += 12;
      if (gesture.x < box.left + 30 && gesture.x > box.left - 10)
        scroller.scrollLeft -= 12;
      if (gesture.y > box.bottom - 25 && gesture.y < box.bottom + 10)
        scroller.scrollTop += 8;
      if (gesture.y < box.top + 25 && gesture.y > box.top - 10)
        scroller.scrollTop -= 8;
      paint();
      frame = requestAnimationFrame(scroll);
    }
    function down(event: PointerEvent) {
      if (latest.current.pending || event.button !== 0 || !event.isPrimary)
        return;
      const target = event.target as HTMLElement;
      const track = target.closest<HTMLElement>("[data-draw]");
      if (!track) return;
      const source = target.closest<HTMLElement>("[data-plan]");
      if (source?.dataset.dragDisabled === "true") return;
      const handle = target.closest<HTMLElement>("[data-resize]");
      if (event.pointerType === "touch" && !handle) return;
      const p = latest.current.preferences;
      gesture = {
        pointer: event.pointerId,
        track,
        source,
        kind: handle?.dataset.resize ?? (source ? "move" : "create"),
        x: event.clientX,
        y: event.clientY,
        downX: event.clientX,
        downY: event.clientY,
        anchor: source
          ? minuteAt(track, event.clientX)
          : clamp(
              snap(minuteAt(track, event.clientX)),
              p.start_minute,
              p.end_minute - 15,
            ),
        start: Number(source?.dataset.start),
        end: Number(source?.dataset.end),
        moved: false,
        valid: true,
        copying: false,
      };
    }
    function move(event: PointerEvent) {
      if (!gesture || gesture.pointer !== event.pointerId) return;
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      gesture.copying =
        gesture.kind === "move" && (event.ctrlKey || event.metaKey);
      if (
        !gesture.moved &&
        Math.hypot(
          event.clientX - gesture.downX,
          event.clientY - gesture.downY,
        ) < 6
      )
        return;
      if (!gesture.moved) {
        gesture.moved = true;
        gesture.track.setPointerCapture(event.pointerId);
        document.body.classList.add("schedule-dragging");
        frame = requestAnimationFrame(scroll);
      }
      paint();
    }
    function up(event: PointerEvent) {
      if (cancelled === event.pointerId) {
        cancelled = null;
        armSuppression();
      }
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const g = gesture;
      if (g.moved) paint();
      clear();
      if (g.moved) {
        armSuppression();
        if (!g.valid || !g.result) return;
        if (g.kind === "create") latest.current.create(g.result);
        else if (g.copying)
          latest.current.copy(g.source!.dataset.plan!, g.result);
        else latest.current.change(g.source!.dataset.plan!, g.result);
      } else if (g.kind === "create") {
        const start = Math.min(
          g.anchor,
          latest.current.preferences.end_minute - 60,
        );
        latest.current.create({
          date: g.track.dataset.date!,
          start_minute: start,
          end_minute: start + 60,
          ...(g.track.dataset.activity
            ? { activity_id: g.track.dataset.activity }
            : {}),
        });
      }
    }
    function click(event: MouseEvent) {
      if (
        suppressClick &&
        event.detail > 0 &&
        root!.contains(event.target as Node)
      ) {
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      } else if (
        event.detail > 0 &&
        !gesture &&
        (event as PointerEvent).pointerType === "touch"
      ) {
        const target = event.target as HTMLElement;
        const track = target.closest<HTMLElement>("[data-draw]");
        if (track && !target.closest("button")) {
          const p = latest.current.preferences;
          const start = clamp(
            snap(minuteAt(track, event.clientX)),
            p.start_minute,
            p.end_minute - 60,
          );
          latest.current.create({
            date: track.dataset.date!,
            start_minute: start,
            end_minute: start + 60,
            ...(track.dataset.activity
              ? { activity_id: track.dataset.activity }
              : {}),
          });
        }
      }
    }
    function contextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement;
      const track = target.closest<HTMLElement>("[data-draw]");
      if (!track || target.closest("[data-plan]") || latest.current.pending)
        return;
      event.preventDefault();
      const p = latest.current.preferences;
      const start = clamp(
        Math.floor(minuteAt(track, event.clientX) / 15) * 15,
        p.start_minute,
        p.end_minute - 15,
      );
      latest.current.create({
        date: track.dataset.date!,
        start_minute: start,
        end_minute: Math.min(start + 60, p.end_minute),
        anchorX: event.clientX,
        ...(track.dataset.activity
          ? { activity_id: track.dataset.activity }
          : {}),
      });
    }
    function modifier(event: KeyboardEvent) {
      if (!gesture?.moved || event.key !== "Control") return;
      gesture.copying = gesture.kind === "move" && event.type === "keydown";
      paint();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && gesture) {
        cancelled = gesture.pointer;
        event.preventDefault();
        event.stopPropagation();
        clear();
        return;
      }
      const target = event.target as HTMLElement;
      const track = target.closest<HTMLElement>("[data-draw]");
      if (!track || latest.current.pending) return;
      if (track === target && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        latest.current.create({
          date: track.dataset.date!,
          ...defaultPlanTimes(latest.current.preferences.timezone),
          ...(track.dataset.activity
            ? { activity_id: track.dataset.activity }
            : {}),
        });
      }
      const block = target.closest<HTMLElement>("[data-plan]");
      if (
        block &&
        event.altKey &&
        ["ArrowLeft", "ArrowRight"].includes(event.key)
      ) {
        event.preventDefault();
        if (block.dataset.dragDisabled === "true") return;
        const p = latest.current.preferences;
        const start = Number(block.dataset.start);
        const end = Number(block.dataset.end);
        const step = event.key === "ArrowLeft" ? -15 : 15;
        const next = clamp(
          start + step,
          p.start_minute,
          p.end_minute - (end - start),
        );
        latest.current.change(block.dataset.plan!, {
          date: block.dataset.date!,
          start_minute: event.shiftKey ? start : next,
          end_minute: event.shiftKey
            ? clamp(end + step, start + 15, p.end_minute)
            : next + end - start,
        });
      }
    }
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", clear);
    root.addEventListener("contextmenu", contextMenu);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("keydown", modifier);
    document.addEventListener("keyup", modifier);
    return () => {
      clear();
      tooltip.remove();
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", clear);
      root.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("keydown", modifier);
      document.removeEventListener("keyup", modifier);
    };
  }, [rootRef]);
}
