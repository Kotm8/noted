import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Select } from "../../../components/ui/select";
import { Notice } from "../../../components/ui/notice";
import { ScheduleDialog } from "../../reminders/components/schedule-dialog";
import { useAllChannels } from "../../workspaces/hooks/use-all-channels";
import { useWorkspaceShell } from "../../workspaces/shell-context";
import { notesApi } from "../../notes/api";

export function NewHomeReminder({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const shell = useWorkspaceShell();
  const channels = (useAllChannels() ?? []).filter(
    (channel) =>
      !channel.kind || channel.kind === "note" || channel.kind === "reminder",
  );
  const [chosen, setChosen] = useState("");
  const [content, setContent] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [pending, setPending] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const channel = channels.find((item) => item.id === chosen) ?? channels[0];
  if (scheduling && channel)
    return (
      <ScheduleDialog
        content={content}
        channelName={channel.name}
        pending={pending}
        onClose={() => setScheduling(false)}
        onConfirm={async (schedule) => {
          setPending(true);
          try {
            await notesApi.create(
              channel.id,
              content,
              schedule,
              requestId.current,
            );
            for (const prefix of ["notes", "schedule", "home-activity"])
              void client.invalidateQueries({ queryKey: [prefix] });
            onClose();
          } finally {
            setPending(false);
          }
        }}
      />
    );
  return (
    <Modal
      open
      title="New reminder"
      description="Choose where to save it, then set when it rings."
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        className="home-reminder-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (content.trim() && channel) setScheduling(true);
        }}
      >
        <label>
          Channel
          <Select
            label="Reminder channel"
            value={channel?.id ?? ""}
            options={channels.map((item) => ({
              value: item.id,
              label: `${shell.navigation.workspaces.find((project) => project.id === item.workspace_id)?.name ?? "Project"} / #${item.name}`,
            }))}
            onChange={setChosen}
          />
        </label>
        <label>
          Reminder
          <textarea
            autoFocus
            aria-label="Reminder text"
            maxLength={40000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
          />
        </label>
        {!channels.length && (
          <Notice>Create a notes or reminder channel first.</Notice>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!channel || !content.trim()}>
            Choose time
          </Button>
        </div>
      </form>
    </Modal>
  );
}
