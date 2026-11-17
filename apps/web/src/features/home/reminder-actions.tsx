import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AlarmClock, Check } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuItem } from "../../components/ui/menu";
import { remindersApi } from "../reminders/api";
import { notificationsApi } from "../notifications/api";

export function HomeReminderActions({
  id,
  revision,
  layout = "buttons",
}: {
  id: string;
  revision: number;
  layout?: "buttons" | "checkbox" | "snooze";
}) {
  const client = useQueryClient();
  const busy = useIsMutating({ mutationKey: ["home-reminder", id] }) > 0;
  const preferences = useQuery({
    queryKey: ["notification-settings"],
    queryFn: notificationsApi.settings,
  });
  const snooze = preferences.data?.snooze_minutes ?? 10;
  const action = useMutation({
    mutationKey: ["home-reminder", id],
    mutationFn: ({
      action,
      minutes,
    }: {
      action: "done" | "snooze";
      minutes?: number;
    }) => remindersApi.act(id, revision, action, minutes),
    onSuccess: (_data, values) =>
      toast.success(
        values.action === "done" ? "Reminder completed" : "Reminder snoozed",
      ),
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      for (const key of ["home-activity", "schedule", "notes"])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  if (layout === "checkbox")
    return (
      <button
        className="home-check"
        role="checkbox"
        aria-checked={false}
        aria-label="Complete reminder"
        title="Complete reminder"
        disabled={busy}
        onClick={() => action.mutate({ action: "done" })}
      />
    );
  return (
    <div className="home-event-actions">
      {layout !== "snooze" && (
        <button
          disabled={busy}
          onClick={() => action.mutate({ action: "done" })}
        >
          <Check size={13} />
          Done
        </button>
      )}
      <Menu
        trigger={
          <button disabled={busy} aria-label="Snooze reminder">
            <AlarmClock size={13} />
            Snooze
          </button>
        }
      >
        {[...new Set([snooze, 5, 10, 15, 30, 60])].map((minutes) => (
          <MenuItem
            key={minutes}
            onSelect={() => action.mutate({ action: "snooze", minutes })}
          >
            {minutes === 60 ? "1 hour" : `${minutes} minutes`}
            {minutes === snooze ? " (default)" : ""}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}
