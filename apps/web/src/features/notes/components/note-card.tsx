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

  return (
    <article
      className={`note ${editing ? "note-editing" : ""}`}
      id={`note-${note.id}`}
      aria-label={`Note from ${createdAt.toLocaleString()}`}
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
            AI reply
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
          {onOpenThread && !note.thread_root_id && (
            <button
              type="button"
              className="icon-button"
              aria-label="Open thread"
              onClick={onOpenThread}
            >
              <MessageSquare size={14} />
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
  );
}
