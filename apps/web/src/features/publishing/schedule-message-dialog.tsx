import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import {
  DateTimePicker,
  localDateTime,
} from "../../components/ui/date-time-picker";
import { publishingApi } from "./api";
import type { ScheduledMessage } from "./types";

export function ScheduleMessageDialog({
  channelId,
  channelName,
  content,
  initial,
  onClose,
  onSaved,
}: {
  channelId: string;
  channelName: string;
  content: string;
  initial?: ScheduledMessage;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState(initial?.content ?? content);
  const [time, setTime] = useState(() =>
    localDateTime(new Date(initial?.send_at ?? Date.now() + 3600000)),
  );
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const date = new Date(time);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
        throw new Error("Choose a time in the future.");
      const data = {
        content: text,
        send_at: date.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      return initial
        ? publishingApi.update(initial.id, initial.revision, data)
        : publishingApi.create(channelId, data);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["publishing"] });
      toast.success(
        initial ? "Scheduled message updated" : "Message scheduled",
      );
      onSaved?.();
      onClose();
    },
    onError: (failure) => setError(failure.message),
  });
  return (
    <Modal
      open
      title={initial ? "Edit scheduled message" : "Send later"}
      description={`#${channelName}`}
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
      className="schedule-dialog publishing-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <label>
          Message
          <textarea
            aria-label="Scheduled message"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={40000}
            rows={4}
            required
          />
        </label>
        <div className="publishing-quick-times">
          {[30, 60, 1440].map((minutes) => (
            <button
              type="button"
              key={minutes}
              onClick={() =>
                setTime(localDateTime(new Date(Date.now() + minutes * 60000)))
              }
            >
              {minutes === 30
                ? "In 30 minutes"
                : minutes === 60
                  ? "In 1 hour"
                  : "In 24 hours"}
            </button>
          ))}
        </div>
        <DateTimePicker
          value={time}
          onChange={setTime}
          label="Choose send date"
        />
        <p className="field-caption">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}. If the server is
          offline at this time, this message is skipped.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!text.trim() || save.isPending}>
            <Clock3 size={16} />
            {save.isPending ? "Saving…" : "Schedule message"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
