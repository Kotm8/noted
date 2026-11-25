import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  Clock3,
  Hash,
  LoaderCircle,
  Plus,
  SendHorizontal,
  Slash,
  CaseSensitive,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "react-router-dom";
import { Button } from "../../../components/ui/button";
import type { Channel } from "../../workspaces/types";
import { useDraft } from "../hooks/use-draft";
import { useComposerFiles } from "../hooks/use-composer-files";
import { PendingFiles } from "./pending-files";
import { ScheduleDialog } from "../../reminders/components/schedule-dialog";
import { noteCommands, parseNoteCommand } from "../../reminders/commands";
import type { ReminderSchedule } from "../../reminders/types";
import { ScheduleMessageDialog } from "../../publishing/schedule-message-dialog";
import { applyEdit } from "../../../lib/list-editing";
import { Menu, MenuItem } from "../../../components/ui/menu";
import {
  useFormatting,
  useFormattingVisible,
} from "../../writing/use-formatting";
import { chatEnter } from "../chat-enter";
import { toStored } from "../mentions";
import { useMentionPicker } from "./mention-picker";
import { isAndroidPilot } from "../../../lib/android-pilot";

interface NoteComposerProps {
  /** Floats just above the composer, whatever its current height. */
  above?: ReactNode;
  channel: Channel;
  isSending: boolean;
  onSend: (
    content: string,
    files: File[],
    reminder?: ReminderSchedule,
  ) => Promise<void>;
  onEditLast: () => void;
  onSent?: () => void;
  /** Text to add to the draft, such as an AI draft; a new `key` adds it again. */
  insert?: { key: number; text: string } | null;
}

export function NoteComposer({
  above,
  channel,
  isSending,
  onSend,
  onEditLast,
  onSent,
  insert,
}: NoteComposerProps) {
  const { draft, setDraft, clearSentDraft, ready, draftSaved } = useDraft(
    channel.id,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!insert) return;
    setDraft((current) =>
      current.trim() ? `${current.trimEnd()}\n\n${insert.text}` : insert.text,
    );
    inputRef.current?.focus();
  }, [insert, setDraft]);
  const location = useLocation();
  useLayoutEffect(() => {
    if (new URLSearchParams(location.search).get("write") === "1")
      inputRef.current?.focus();
  }, [location.key, location.search]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { files, setFiles, addFiles, filesLoading } = useComposerFiles(
    channel.id,
  );
  const [scheduledDraft, setScheduledDraft] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<{
    content: string;
    draft: string;
    files: File[];
    delay: number;
  } | null>(null);
  const submitting = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mentions = useMentionPicker(inputRef, draft);
  const stored = (text: string) => toStored(text, mentions.refs.current);
  const formatting = useFormatting(inputRef);
  const [formattingVisible, toggleFormatting] = useFormattingVisible();

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }, [draft]);

  async function sendNote() {
    if (
      !ready ||
      filesLoading ||
      (!draft.trim() && !files.length) ||
      (isAndroidPilot && submitting.current) ||
      (files.length > 0 && (isSending || submitting.current)) ||
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
        content: stored(content),
        draft,
        files: [...files],
        delay: command?.delay ?? 60,
      });
      return;
    }

    submitting.current = true;
    // Clear at once so typing during the request starts a new message instead
    // of being appended to the one already on its way. Messages sent meanwhile
    // wait their turn, so they arrive in the order they were written.
    if (!isAndroidPilot) setDraft("");
    const send = queue.current.then(() => onSend(stored(sentContent), files));
    queue.current = send.catch(() => undefined);
    try {
      await send;
      if (isAndroidPilot) clearSentDraft(sentContent);
      setFiles([]);
      onSent?.();
      if (!isAndroidPilot) inputRef.current?.focus();
    } catch {
      if (!isAndroidPilot)
        setDraft((typed) => (typed ? `${sentContent}\n${typed}` : sentContent));
    } finally {
      submitting.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentions.onKeyDown(event) || formatting.onKeyDown(event)) return;
    chatEnter(event, () => void sendNote());

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
        if (isSending || filesLoading || !event.dataTransfer.files.length)
          return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {above}
      <PendingFiles
        files={files}
        disabled={isSending || filesLoading}
        onRemove={(index) =>
          setFiles((current) =>
            current.filter((_, position) => position !== index),
          )
        }
      />
      <input
        ref={fileInputRef}
        hidden
        type="file"
        multiple
        aria-label="Attach files"
        disabled={isSending || filesLoading}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {mentions.menu}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendNote();
        }}
      >
        {formattingVisible && formatting.toolbar}
        <textarea
          ref={inputRef}
          aria-label={`Message ${channel.name}`}
          placeholder={`Message #${channel.name}`}
          value={draft}
          readOnly={!ready}
          maxLength={40000}
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onSelect={mentions.onSelect}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length && !isSending && !filesLoading) {
              event.preventDefault();
              addFiles(pasted);
            }
          }}
        />
        <div className="composer-actions">
          <button
            className="icon-button attach-button"
            type="button"
            aria-label="Add files"
            title="Add files"
            disabled={isSending || filesLoading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={19} />
          </button>
          <button
            className="icon-button composer-format-toggle"
            type="button"
            aria-label={
              formattingVisible ? "Hide formatting" : "Show formatting"
            }
            title={formattingVisible ? "Hide formatting" : "Show formatting"}
            aria-pressed={formattingVisible}
            onClick={toggleFormatting}
          >
            <CaseSensitive size={19} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Mention a channel"
            title="Mention a channel"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const input = inputRef.current;
              if (!input) return;
              const { selectionStart: start, selectionEnd: end } = input;
              const space =
                start > 0 && !/\s/.test(draft[start - 1]) ? " " : "";
              applyEdit(input, { start, end, text: `${space}#` });
            }}
          >
            <Hash size={17} />
          </button>
          <Menu
            align="start"
            trigger={
              <button
                className="icon-button"
                type="button"
                aria-label="Commands"
                title="Commands"
              >
                <Slash size={16} />
              </button>
            }
          >
            {noteCommands.map((command) => (
              <MenuItem
                key={command.name}
                onSelect={() => {
                  setDraft((text) =>
                    text.startsWith(command.name)
                      ? text
                      : `${command.name} ${text}`,
                  );
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <span className="command-menu-item">
                  <strong>{command.name}</strong>
                  <small>{command.description}</small>
                </span>
              </MenuItem>
            ))}
          </Menu>
          <span className="composer-actions-gap" />
          <div className="send-group">
            <Button
              size="icon"
              type="submit"
              className="send-button"
              aria-label="Send note"
              disabled={
                !ready ||
                filesLoading ||
                (!draft.trim() && !files.length) ||
                (files.length > 0 && isSending)
              }
            >
              {isSending ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <SendHorizontal size={17} strokeWidth={1.75} />
              )}
            </Button>
            {channel.kind === "note" && (
              <Menu
                trigger={
                  <button
                    className="icon-button send-options"
                    type="button"
                    aria-label="Send options"
                    title="Send options"
                    disabled={!draft.trim() || files.length > 0 || isSending}
                  >
                    <ChevronDown size={14} />
                  </button>
                }
              >
                <MenuItem onSelect={() => setScheduledDraft(draft)}>
                  <Clock3 size={15} />
                  Schedule message
                </MenuItem>
              </Menu>
            )}
          </div>
        </div>
      </form>
      {formatting.dialog}

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
        {draft && draftSaved && (
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
          content={stored(scheduledDraft)}
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
