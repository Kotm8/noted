import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Clock3, LoaderCircle, Plus, X, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatFileSize } from "../../../lib/format";
import { Button } from "../../../components/ui/button";
import type { Channel } from "../../workspaces/types";
import { useDraft } from "../hooks/use-draft";
import { ScheduleDialog } from "../../reminders/components/schedule-dialog";
import { noteCommands, parseNoteCommand } from "../../reminders/commands";
import type { ReminderSchedule } from "../../reminders/types";
import { ScheduleMessageDialog } from "../../publishing/schedule-message-dialog";

interface NoteComposerProps {
  channel: Channel;
  isSending: boolean;
  onSend: (
    content: string,
    files: File[],
    reminder?: ReminderSchedule,
  ) => Promise<void>;
  onEditLast: () => void;
  onSent?: () => void;
}

export function NoteComposer({
  channel,
  isSending,
  onSend,
  onEditLast,
  onSent,
}: NoteComposerProps) {
  const { draft, setDraft, clearSentDraft } = useDraft(channel.id);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [scheduledDraft, setScheduledDraft] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{
    content: string;
    draft: string;
    files: File[];
    delay: number;
  } | null>(null);
  const submitting = useRef(false);

  function addFiles(incoming: File[]) {
    const next = [...files, ...incoming];
    if (
      next.length > 10 ||
      next.some((file) => file.size > 250 * 1024 * 1024) ||
      next.reduce((size, file) => size + file.size, 0) > 500 * 1024 * 1024
    ) {
      toast.error("Choose up to 10 files, 250 MB each and 500 MB total.");
      return;
    }
    setFiles(next);
  }

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [draft]);

  async function sendNote() {
    if (
      (!draft.trim() && !files.length) ||
      isSending ||
      submitting.current ||
      scheduling ||
      scheduledDraft !== null
    )
      return;
    const sentContent = draft;
    const command = parseNoteCommand(draft);
    if (channel.kind === "reminder" || command) {
      const content = command?.content ?? draft;
      if (!content.trim() && !files.length) {
        toast.error("Write a message after /remind.");
        return;
      }
      setScheduling({
        content,
        draft,
        files: [...files],
        delay: command?.delay ?? 10,
      });
      return;
    }

    submitting.current = true;
    try {
      await onSend(sentContent, files);
      setFiles([]);
      clearSentDraft(sentContent);
      onSent?.();
      inputRef.current?.focus();
    } catch {
      return;
    } finally {
      submitting.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (!event.repeat) void sendNote();
    }

    if (event.key === "ArrowUp" && !draft) {
      event.preventDefault();
      onEditLast();
    }
  }

  return (
    <div
      className="composer-area"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (isSending || !event.dataTransfer.files.length) return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((file, index) => (
            <div className="pending-file" key={`${file.name}-${index}`}>
              <FileText size={18} />
              <span>
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </span>
              <button
                className="icon-button"
                aria-label={`Remove ${file.name}`}
                disabled={isSending}
                onClick={() =>
                  setFiles((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileInputRef}
        hidden
        type="file"
        multiple
        aria-label="Attach files"
        disabled={isSending}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendNote();
        }}
      >
        <button
          className="icon-button attach-button"
          type="button"
          aria-label="Add files"
          disabled={isSending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus size={21} />
        </button>
        <textarea
          ref={inputRef}
          aria-label={`Message ${channel.name}`}
          placeholder={`Message #${channel.name}`}
          value={draft}
          maxLength={40000}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length && !isSending) {
              event.preventDefault();
              addFiles(pasted);
            }
          }}
        />
        {channel.kind === "note" && (
          <button
            className="icon-button"
            type="button"
            aria-label="Schedule message"
            title={
              files.length ? "Send later supports text messages" : "Send later"
            }
            disabled={!draft.trim() || files.length > 0 || isSending}
            onClick={() => setScheduledDraft(draft)}
          >
            <Clock3 size={18} />
          </button>
        )}
        <Button
          size="icon"
          type="submit"
          className="send-button"
          aria-label="Send note"
          disabled={(!draft.trim() && !files.length) || isSending}
        >
          {isSending ? (
            <LoaderCircle size={18} className="animate-spin" />
          ) : (
            <ArrowUp size={20} strokeWidth={1.75} />
          )}
        </Button>
      </form>

      <div className="composer-footer">
        {draft.startsWith("/") &&
          noteCommands
            .filter((command) => command.name.startsWith(draft.split(" ")[0]))
            .map((command) => (
              <button
                type="button"
                className="command-suggestion"
                key={command.name}
                onClick={() => {
                  setDraft(`${command.name} `);
                  inputRef.current?.focus();
                }}
              >
                <strong>{command.name}</strong>
                {command.description}
              </button>
            ))}
        {draft && (
          <span className="draft-status">Draft saved on this device</span>
        )}
      </div>
      {scheduling && (
        <ScheduleDialog
          content={scheduling.content}
          channelName={channel.name}
          delay={scheduling.delay}
          pending={isSending}
          onClose={() => setScheduling(null)}
          onConfirm={async (reminder) => {
            await onSend(scheduling.content, scheduling.files, reminder);
            clearSentDraft(scheduling.draft);
            setFiles([]);
            setScheduling(null);
            onSent?.();
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      )}
      {scheduledDraft !== null && (
        <ScheduleMessageDialog
          channelId={channel.id}
          channelName={channel.name}
          content={scheduledDraft}
          onClose={() => setScheduledDraft(null)}
          onSaved={() => {
            clearSentDraft(scheduledDraft);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
