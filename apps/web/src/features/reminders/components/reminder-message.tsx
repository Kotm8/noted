import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ChevronDown, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { notificationsApi } from "../../notifications/api";
import type { Note } from "../../notes/types";
import { remindersApi } from "../api";
import type { ReminderSchedule } from "../types";
import { ScheduleDialog } from "./schedule-dialog";

function timeLeft(due: number, now: number) {
  const seconds = Math.max(0, Math.ceil((due - now) / 1000));
  if (!seconds) return "Due";
  if (seconds >= 86400)
    return `Time left: ${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  if (seconds >= 3600)
    return `Time left: ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `Time left: ${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function ReminderMessage({
  note,
  channelName,
  children,
}: {
  note: Note;
  channelName: string;
  children: ReactNode;
}) {
  const reminder = note.reminder!;
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["notification-settings"],
    queryFn: notificationsApi.settings,
    staleTime: 30000,
  });
  const snooze = preferences.data?.snooze_minutes ?? 10;
  const mutation = useMutation({
    mutationFn: ({
      action,
      minutes,
      schedule,
    }: {
      action?: "done" | "restore" | "snooze";
      minutes?: number;
      schedule?: ReminderSchedule;
    }) =>
      schedule
        ? remindersApi.schedule(note.id, schedule)
        : remindersApi.act(note.id, reminder.revision, action!, minutes),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["notes", note.channel_id] });
      setEditing(false);
    },
    onError: (error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["notes", note.channel_id] });
    },
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const done = optimisticDone ?? reminder.status === "done";
  return (
    <div className={`reminder-message ${done ? "reminder-completed" : ""}`}>
      <input
        type="checkbox"
        className="reminder-checkbox"
        aria-label={done ? "Restore reminder" : "Complete reminder"}
        checked={done}
        disabled={mutation.isPending}
        onChange={() => {
          setOptimisticDone(!done);
          mutation.mutate(
            { action: done ? "restore" : "done" },
            { onSettled: () => setOptimisticDone(null) },
          );
        }}
      />
      <div className="reminder-body">
        {children}
        <div
          className={`reminder-countdown ${!done && new Date(reminder.due_at).getTime() <= now ? "reminder-due" : ""}`}
        >
          <Clock3 size={12} />
          {done ? "Done" : timeLeft(new Date(reminder.due_at).getTime(), now)}
          {reminder.repeat !== "none" && (
            <span>
              ·{" "}
              {reminder.repeat === "weekdays"
                ? "Weekdays"
                : reminder.repeat === "weekly"
                  ? "Every week"
                  : "Every day"}
            </span>
          )}
        </div>
        <button
          type="button"
          className="reminder-time"
          onClick={() => setEditing(true)}
        >
          Rings{" "}
          {new Date(reminder.due_at).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </button>
      </div>
      {!done && (
        <div className="reminder-snooze">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: "snooze" })}
          >
            <AlarmClock size={15} />
            Snooze {snooze}m
          </button>
          <Menu
            trigger={
              <button
                type="button"
                aria-label="Choose snooze duration"
                disabled={mutation.isPending}
              >
                <ChevronDown size={14} />
              </button>
            }
          >
            {[...new Set([5, 10, 15, 30, 60, snooze])]
              .sort((a, b) => a - b)
              .map((minutes) => (
                <MenuItem
                  key={minutes}
                  onSelect={() =>
                    mutation.mutate({ action: "snooze", minutes })
                  }
                >
                  {minutes} minutes
                </MenuItem>
              ))}
          </Menu>
        </div>
      )}
      {editing && (
        <ScheduleDialog
          content={note.content}
          channelName={channelName}
          initial={reminder}
          pending={mutation.isPending}
          onClose={() => setEditing(false)}
          onConfirm={async (schedule) => {
            await mutation.mutateAsync({ schedule });
          }}
        />
      )}
    </div>
  );
}
