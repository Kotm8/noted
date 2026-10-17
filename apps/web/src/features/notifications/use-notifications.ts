import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "../../lib/http";
import { remindersApi } from "../reminders/api";
import { createDeviceId, notificationDevice } from "./browser";

export function useNotifications() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const device = { ...notificationDevice(), device_id: createDeviceId() };
    const heartbeat = () => {
      void request("/notifications/presence", "POST", {
        ...device,
        focused: document.visibilityState === "visible" && document.hasFocus(),
      }).catch(() => {});
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15000);
    window.addEventListener("focus", heartbeat);
    window.addEventListener("blur", heartbeat);
    document.addEventListener("visibilitychange", heartbeat);
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
      void request("/notifications/presence", "POST", {
        ...device,
        focused: false,
      }).catch(() => {});
    };
  }, [queryClient]);
}
