import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { remindersApi } from "../../reminders/api";
import { ScheduleDialog } from "../../reminders/components/schedule-dialog";
import type { ReminderSchedule } from "../../reminders/types";
import type { Note } from "../types";

export function useNoteReminder(note: Note, channel: string) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: ReminderSchedule | "done" | "restore" | "snooze") =>
      typeof data === "string"
        ? remindersApi.act(note.id, note.reminder!.revision, data)
        : remindersApi.schedule(note.id, data),
    onSuccess: async () => {
      setOpen(false);
      await Promise.all(
        ["notes", "thread", "home-activity", "schedule"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onError: (error) => toast.error(error.message),
  });
  return {
    open: () => setOpen(true),
    pending: mutation.isPending,
    act: (action: "done" | "restore" | "snooze") => mutation.mutate(action),
    dialog: open ? (
      <ScheduleDialog
        content={note.content}
        channelName={channel}
        initial={note.reminder ?? undefined}
        pending={mutation.isPending}
        confirmLabel="Set reminder"
        onClose={() => setOpen(false)}
        onConfirm={async (schedule) => {
          await mutation.mutateAsync(schedule);
        }}
      />
    ) : null,
  };
}
