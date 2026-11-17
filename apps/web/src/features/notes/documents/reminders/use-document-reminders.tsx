import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { liveInterval } from "../../../../lib/live";
import { ScheduleDialog } from "../../../reminders/components/schedule-dialog";
import type { ReminderSchedule } from "../../../reminders/types";
import { documentReminderCommand, reminderLink } from "./command";
import { documentRemindersApi, type DocumentReminder } from "./api";

type Command = NonNullable<ReturnType<typeof documentReminderCommand>> & {
  id: string;
};

export function useDocumentReminders({
  channelId,
  channelName,
  content,
  setContent,
  flush,
}: {
  channelId: string;
  channelName: string;
  content: string;
  setContent: (value: string) => void;
  flush: () => Promise<void>;
}) {
  const client = useQueryClient();
  const key = ["document-reminders", channelId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => documentRemindersApi.list(channelId),
    refetchInterval: () => liveInterval(30000),
  });
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const [editing, setEditing] = useState<DocumentReminder | null>(null);
  const mutation = useMutation({
    mutationFn: async ({
      item,
      action,
    }: {
      item: DocumentReminder;
      action: "done" | "restore" | "snooze" | "remove";
    }) => {
      if (action === "remove") await documentRemindersApi.remove(item);
      else await documentRemindersApi.act(item, action);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  function begin(text: string, start: number, end: number) {
    const parsed = documentReminderCommand(text, start, end);
    if (!parsed) return false;
    if (!parsed.content.trim() || parsed.content.length > 500) {
      toast.error("Write a reminder name after /remind, up to 500 characters.");
      return true;
    }
    setCommand({ ...parsed, id: crypto.randomUUID() });
    return true;
  }
  const items = query.data ?? [];
  async function create(schedule: ReminderSchedule) {
    if (!command) return;
    if (content !== command.source)
      throw new Error(
        "The note changed. Cancel and enter the reminder command again.",
      );
    setSaving(true);
    try {
      await flush();
      const item = await documentRemindersApi.create(
        channelId,
        command.id,
        command.content.trim(),
        schedule,
      );
      client.setQueryData<DocumentReminder[]>(key, (current = []) => [
        ...current.filter((row) => row.id !== item.id),
        item,
      ]);
      setContent(
        command.source.slice(0, command.start) +
          reminderLink(item.name, item.id) +
          "\n" +
          command.source.slice(command.end),
      );
      setCommand(null);
      try {
        await flush();
      } catch {
        toast.error("Reminder saved. Its link is kept in your unsaved draft.");
      }
    } finally {
      setSaving(false);
    }
  }
  return {
    query,
    items,
    begin,
    pending: mutation.isPending,
    checked,
    completed: new Set(
      items
        .filter((item) => checked[item.id] ?? item.status === "done")
        .map((item) => item.id),
    ),
    act: (
      item: DocumentReminder,
      action: "done" | "restore" | "snooze" | "remove",
    ) => {
      if (action === "done" || action === "restore")
        setChecked((current) => ({ ...current, [item.id]: action === "done" }));
      mutation.mutate(
        { item, action },
        {
          onSettled: () =>
            setChecked((current) => {
              const next = { ...current };
              delete next[item.id];
              return next;
            }),
        },
      );
    },
    edit: (item: DocumentReminder) => setEditing(item),
    open: (id: string) => {
      const item = items.find((row) => row.id === id);
      if (item) setEditing(item);
      else toast("This reminder was removed.");
    },
    dialog: command ? (
      <ScheduleDialog
        content={command.content}
        channelName={channelName}
        delay={command.delay}
        confirmLabel="Set reminder"
        pending={saving}
        onClose={() => setCommand(null)}
        onConfirm={create}
      />
    ) : editing ? (
      <ScheduleDialog
        content={editing.name}
        channelName={channelName}
        initial={editing}
        pending={saving}
        onClose={() => setEditing(null)}
        onConfirm={async (schedule) => {
          setSaving(true);
          try {
            const current =
              items.find((item) => item.id === editing.id) ?? editing;
            await documentRemindersApi.update(current, schedule);
            setEditing(null);
            await client.invalidateQueries({ queryKey: key });
          } finally {
            setSaving(false);
          }
        }}
      />
    ) : null,
  };
}
