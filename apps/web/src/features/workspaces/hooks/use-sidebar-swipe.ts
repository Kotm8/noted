import { useEffect, useEffectEvent, useRef } from "react";
import { isMobileLayout } from "../../../lib/layout";
import { isAndroidApp } from "../../notifications/android";

export function useSidebarSwipe(
  open: boolean,
  blocked: boolean,
  onChange: (open: boolean) => void,
) {
  const root = useRef<HTMLDivElement>(null);
  const change = useEffectEvent(onChange);
  useEffect(() => {
    const element = root.current;
    if (!element || !isAndroidApp() || blocked) return;
    let gesture: {
      x: number;
      y: number;
      started: number;
      horizontal: boolean;
    } | null = null;
    function reset() {
      gesture = null;
    }
    function start(event: TouchEvent) {
      reset();
      if (
        !isMobileLayout() ||
        event.touches.length !== 1 ||
        document.querySelector('[role="dialog"], [role="menu"]') ||
        window.getSelection()?.toString()
      )
        return;
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.closest(
          'input, textarea, select, video, audio, pre, [contenteditable="true"], .schedule-grid',
        )
      )
        return;
      if (target.closest("button, a")) return;
      const touch = event.touches[0];
      if (!open && (touch.clientX < 24 || touch.clientX > 112)) return;
      if (
        open &&
        !target.closest(".channel-sidebar, .workspace-rail, .mobile-scrim")
      )
        return;
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        started: performance.now(),
        horizontal: false,
      };
    }
    function move(event: TouchEvent) {
      if (!gesture || event.touches.length !== 1) {
        reset();
        return;
      }
      const dx = event.touches[0].clientX - gesture.x;
      const dy = Math.abs(event.touches[0].clientY - gesture.y);
      if (!gesture.horizontal) {
        if (dy > 12 && dy >= Math.abs(dx)) {
          reset();
          return;
        }
        if (Math.abs(dx) < 12) return;
        if ((open ? dx >= 0 : dx <= 0) || Math.abs(dx) < dy * 1.5) {
          reset();
          return;
        }
        gesture.horizontal = true;
      }
      if (event.cancelable) event.preventDefault();
    }
    function end(event: TouchEvent) {
      const current = gesture;
      reset();
      if (!current?.horizontal || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - current.x;
      const dy = Math.abs(event.changedTouches[0].clientY - current.y);
      if (
        (open ? -dx : dx) >= 64 &&
        Math.abs(dx) > dy * 1.5 &&
        performance.now() - current.started < 900
      ) {
        if (event.cancelable) event.preventDefault();
        change(!open);
      }
    }
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: false });
    element.addEventListener("touchcancel", reset);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
    };
  }, [open, blocked]);
  return root;
}
