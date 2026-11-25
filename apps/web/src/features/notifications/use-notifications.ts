import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { androidPilot, isAndroidPilot } from "../../lib/android-pilot";
import { remindersApi } from "../reminders/api";

export function useNotifications() {
  const queryClient = useQueryClient();
  useEffect(() => {
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
  }, [queryClient]);
  useEffect(() => {
    if (!isAndroidPilot) return;
    const reconcile = () => {
      if (document.visibilityState === "visible")
        void androidPilot.reconcileNotifications().catch(() => {});
    };
    const timer = window.setInterval(reconcile, 60000);
    reconcile();
    window.addEventListener("online", reconcile);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", reconcile);
    };
  }, []);
}
