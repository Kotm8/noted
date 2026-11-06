import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "../../lib/http";
import { remindersApi } from "../reminders/api";
import { createDeviceId, notificationDevice } from "./browser";

/**
 * A window can stay focused and "visible" while the owner works on another virtual desktop
 * or walks away, and a focused desktop keeps phone alerts quiet. So it only counts as
 * present after recent input.
 */
const IDLE_AFTER_MS = 3 * 60 * 1000;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
];

export function useNotifications() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const device = { ...notificationDevice(), device_id: createDeviceId() };
    let lastInput = Date.now();
    let reported: boolean | null = null;
    const present = () =>
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      Date.now() - lastInput < IDLE_AFTER_MS;
    const heartbeat = () => {
      reported = present();
      void request("/notifications/presence", "POST", {
        ...device,
        focused: reported,
      }).catch(() => {});
    };
    const active = () => {
      lastInput = Date.now();
      // Coming back from idle is reported at once, not at the next heartbeat.
      if (reported === false && present()) heartbeat();
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15000);
    window.addEventListener("focus", heartbeat);
    window.addEventListener("blur", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, active, { passive: true, capture: true });
    const url = new URL(window.location.href);
    const action = url.searchParams.get("reminderAction");
    const id = url.searchParams.get("note");
    const revision = Number(url.searchParams.get("revision"));
    const snooze = Number(url.searchParams.get("snoozeMinutes"));
    if (id && revision > 0 && (action === "done" || action === "snooze")) {
      url.searchParams.delete("reminderAction");
      url.searchParams.delete("revision");
      url.searchParams.delete("snoozeMinutes");
      window.history.replaceState(window.history.state, "", url);
      void remindersApi
        .act(
          id,
          revision,
          action,
          action === "snooze" &&
            Number.isInteger(snooze) &&
            snooze > 0 &&
            snooze <= 10080
            ? snooze
            : undefined,
        )
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["notes"] });
          toast.success(
            action === "done" ? "Reminder completed" : "Reminder snoozed",
          );
        })
        .catch((error: Error) => toast.error(error.message));
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", heartbeat);
      window.removeEventListener("blur", heartbeat);
      document.removeEventListener("visibilitychange", heartbeat);
      for (const name of ACTIVITY_EVENTS)
        window.removeEventListener(name, active, { capture: true });
      void request("/notifications/presence", "POST", {
        ...device,
        focused: false,
      }).catch(() => {});
    };
  }, [queryClient]);
}
