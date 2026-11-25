import { useRef, useState } from "react";
import {
  Bell,
  AlarmClock,
  Check,
  Copy,
  History,
  Image as ImageIcon,
} from "lucide-react";
import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { copyText, copyPicture } from "../../../lib/clipboard";
import { useNoteReminder } from "../hooks/use-note-reminder";
import {
  ChevronRight,
  Download,
  MessageSquare,
  Pencil,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { NoteAttachments } from "./note-attachments";
import type { Note } from "../types";
import { MessageMarkdown } from "./message-markdown";
import { NoteEditor } from "./note-editor";
import { EditHistory } from "./edit-history";
import { ReminderMessage } from "../../reminders/components/reminder-message";
import { CopyNoteButton } from "./copy-note-button";
import { canShare, downloadAttachments, shareNote } from "../share";

function replyTime(value: string) {
  const date = new Date(value);
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) /
      86400000,
  );
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

interface NoteCardProps {
  channelName: string;
  note: Note;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onOpenThread?: () => void;
  onAskAi?: (anchor: HTMLElement) => void;
  preview?: { text: string; done: boolean };
}

export function NoteCard({
  channelName,
  note,
  editing,
  onEdit,
  onCancelEdit,
  onDelete,
  onOpenThread,
  onAskAi,
  preview,
}: NoteCardProps) {
  const element = useRef<HTMLElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const remind = useNoteReminder(note, channelName);
  const createdAt = new Date(note.created_at);
  const hasText = Boolean(note.content.trim());
  const hasFiles = note.attachments.length > 0;
  const image = note.attachments.find((file) =>
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
      file.content_type,
    ),
  );
  const hasAiInput = hasText || Boolean(image);
  const sharing = canShare();
  const wasEdited = note.updated_at !== note.created_at;
  const content = (
    <>
      {editing ? (
        <NoteEditor note={note} onClose={onCancelEdit} />
      ) : preview ? (
        <div className="ai-preview">
          <p className="ai-before">{note.content}</p>
          <p className={`ai-after${preview.done ? "" : " streaming"}`}>
            {preview.text}
          </p>
        </div>
      ) : (
        <MessageMarkdown note={note} />
      )}
      <NoteAttachments attachments={note.attachments} />
      {!!note.reply_count && onOpenThread && (
        <button
          className="note-thread-link"
          type="button"
          onClick={onOpenThread}
        >
          <MessageSquare size={14} />
          <strong>
            {note.reply_count} {note.reply_count === 1 ? "reply" : "replies"}
          </strong>
          {note.last_reply_at && (
            <span>Last reply {replyTime(note.last_reply_at)}</span>
          )}
          <ChevronRight size={15} className="note-thread-arrow" />
        </button>
      )}
    </>
  );

  const actions = (
    <>
      {onOpenThread && (
        <MenuItem onSelect={onOpenThread}>
          <MessageSquare size={14} />
          Reply in thread
        </MenuItem>
      )}
      {hasText && (
        <MenuItem onSelect={() => void copyText(note.content)}>
          <Copy size={14} />
          Copy text
        </MenuItem>
      )}
      {image && (
        <MenuItem
          onSelect={() =>
            void copyPicture(
              image.original_url ?? `/api/v1/attachments/${image.id}/original`,
            )
          }
        >
          <ImageIcon size={14} />
          Copy image
        </MenuItem>
      )}
      <MenuItem onSelect={onEdit}>
        <Pencil size={14} />
        Edit note
      </MenuItem>
      {wasEdited && (
        <MenuItem onSelect={() => setHistoryOpen(true)}>
          <History size={14} />
          Edit history
        </MenuItem>
      )}
      {!note.thread_root_id && (
        <MenuItem onSelect={remind.open}>
          <Bell size={14} />
          {note.reminder ? "Change reminder time" : "Remind me"}
        </MenuItem>
      )}
      {note.reminder && (
        <>
          <MenuItem
            disabled={remind.pending}
            onSelect={() =>
              remind.act(note.reminder!.status === "done" ? "restore" : "done")
            }
          >
            <Check size={14} />
            {note.reminder.status === "done"
              ? "Restore reminder"
              : "Complete reminder"}
          </MenuItem>
          {note.reminder.status !== "done" && (
            <MenuItem
              disabled={remind.pending}
              onSelect={() => remind.act("snooze")}
            >
              <AlarmClock size={14} />
              Snooze reminder
            </MenuItem>
          )}
        </>
      )}
      {onAskAi && hasAiInput && (
        <MenuItem onSelect={() => element.current && onAskAi(element.current)}>
          <Sparkles size={14} />
          Ask AI
        </MenuItem>
      )}
      {sharing && (
        <MenuItem onSelect={() => void shareNote(note, "all")}>
          <Share2 size={14} />
          Share note
        </MenuItem>
      )}
      {hasFiles && (
        <MenuItem onSelect={() => downloadAttachments(note.attachments)}>
          <Download size={14} />
          Download attachments
        </MenuItem>
      )}
      <MenuItem danger onSelect={onDelete}>
        <Trash2 size={14} />
        Delete note
      </MenuItem>
    </>
  );
  return (
    <>
      <ContextMenu
        disabled={editing || Boolean(preview)}
        label="Message actions"
        menu={actions}
        touch
      >
        <article
          ref={element}
          className={`note ${editing ? "note-editing" : ""}`}
          id={`note-${note.id}`}
          aria-label={`Note from ${createdAt.toLocaleString()}`}
          data-hold-actions={!editing && !preview ? "" : undefined}
          tabIndex={0}
        >
          <time
            className="note-time"
            dateTime={note.created_at}
            title={createdAt.toLocaleString()}
          >
            {createdAt.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
          <div className="note-main">
            {note.ai_generated && (
              <span className="note-ai-tag" title="Written by the assistant">
                <Sparkles size={11} />
                Assistant
              </span>
            )}
            {note.reminder ? (
              <ReminderMessage note={note} channelName={channelName}>
                {content}
              </ReminderMessage>
            ) : (
              content
            )}
          </div>

          {!editing && (
            <div className="note-actions">
              {onOpenThread && !note.thread_root_id && (
                <button
                  type="button"
                  className="icon-button note-thread-action"
                  aria-label="Reply in thread"
                  onClick={onOpenThread}
                >
                  <MessageSquare size={14} />
                  <span>Reply in thread</span>
                </button>
              )}

              {!note.thread_root_id && (
                <button
                  className="icon-button"
                  aria-label={
                    note.reminder ? "Change reminder time" : "Remind me"
                  }
                  onClick={remind.open}
                >
                  <Bell size={14} />
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Edit note"
                onClick={onEdit}
              >
                <Pencil size={14} />
              </button>
              <CopyNoteButton
                content={note.content}
                imageUrl={
                  image
                    ? (image.original_url ??
                      `/api/v1/attachments/${image.id}/original`)
                    : undefined
                }
              />
              {onAskAi && hasAiInput && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Ask AI"
                  title="Ask AI"
                  onClick={(event) => onAskAi(event.currentTarget)}
                >
                  <Sparkles size={14} />
                </button>
              )}
              {sharing && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Share note"
                  title="Share"
                  onClick={() => void shareNote(note, "all")}
                >
                  <Share2 size={14} />
                </button>
              )}
              {hasFiles && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    note.attachments.length === 1
                      ? "Download file"
                      : `Download ${note.attachments.length} files`
                  }
                  title="Download"
                  onClick={() => downloadAttachments(note.attachments)}
                >
                  <Download size={14} />
                </button>
              )}
              {wasEdited && <EditHistory note={note} />}
              <button
                type="button"
                className="icon-button note-delete"
                aria-label="Delete note"
                title="Delete"
                onClick={onDelete}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </article>
      </ContextMenu>
      {remind.dialog}
      {historyOpen && (
        <EditHistory note={note} onClose={() => setHistoryOpen(false)} />
      )}
    </>
  );
}
