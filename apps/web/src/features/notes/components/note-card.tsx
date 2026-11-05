import {
  Download,
  FileText,
  Files,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRef } from "react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { NoteAttachments } from "./note-attachments";
import type { Note } from "../types";
import { MessageMarkdown } from "./message-markdown";
import { NoteEditor } from "./note-editor";
import { EditHistory } from "./edit-history";
import { ReminderMessage } from "../../reminders/components/reminder-message";
import { CopyNoteButton } from "./copy-note-button";
import { canShare, downloadAttachments, shareNote } from "../share";

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
  const aiButton = useRef<HTMLButtonElement>(null);
  const openingAi = useRef(false);
  const createdAt = new Date(note.created_at);
  const hasText = Boolean(note.content.trim());
  const hasFiles = note.attachments.length > 0;
  const hasAiInput =
    hasText ||
    note.attachments.some((file) =>
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.content_type,
      ),
    );
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
      {wasEdited && !editing && <EditHistory note={note} />}
      {!!note.reply_count && onOpenThread && (
        <button
          className="note-thread-link"
          type="button"
          onClick={onOpenThread}
        >
          <MessageSquare size={13} />
          {note.reply_count} {note.reply_count === 1 ? "reply" : "replies"}
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
          <CopyNoteButton content={note.content} />
          {onAskAi && hasAiInput && (
            <button
              type="button"
              className="icon-button"
              aria-label="Ask AI"
              title="Ask AI"
              ref={aiButton}
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
          <Menu
            onCloseAutoFocus={(event) => {
              if (openingAi.current) {
                event.preventDefault();
                openingAi.current = false;
              }
            }}
            trigger={
              <button className="icon-button" aria-label="Note options">
                <MoreHorizontal size={17} />
              </button>
            }
          >
            {onAskAi && hasAiInput && (
              <MenuItem
                onSelect={() => {
                  const anchor = aiButton.current;
                  if (anchor) {
                    openingAi.current = true;
                    requestAnimationFrame(() => onAskAi(anchor));
                  }
                }}
              >
                <Sparkles size={14} />
                Ask AI
              </MenuItem>
            )}
            <MenuItem onSelect={onEdit}>
              <Pencil size={14} />
              Edit note
            </MenuItem>
            {sharing && (
              <MenuItem onSelect={() => void shareNote(note, "all")}>
                <Share2 size={14} />
                Share
              </MenuItem>
            )}
            {sharing && hasText && hasFiles && (
              <MenuItem onSelect={() => void shareNote(note, "text")}>
                <FileText size={14} />
                Share text only
              </MenuItem>
            )}
            {sharing && hasText && hasFiles && (
              <MenuItem onSelect={() => void shareNote(note, "files")}>
                <Files size={14} />
                Share files only
              </MenuItem>
            )}
            {hasFiles && (
              <MenuItem onSelect={() => downloadAttachments(note.attachments)}>
                <Download size={14} />
                {note.attachments.length === 1
                  ? "Download file"
                  : `Download ${note.attachments.length} files`}
              </MenuItem>
            )}
            <MenuItem danger onSelect={onDelete}>
              <Trash2 size={14} />
              Delete note
            </MenuItem>
          </Menu>
        </div>
      )}
    </article>
  );
}
