import {
  Download,
  FileText,
  Files,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { NoteAttachments } from "./note-attachments";
import type { Note } from "../types";
import { MessageMarkdown } from "./message-markdown";
import { NoteEditor } from "./note-editor";
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
}

export function NoteCard({
  channelName,
  note,
  editing,
  onEdit,
  onCancelEdit,
  onDelete,
  onOpenThread,
}: NoteCardProps) {
  const createdAt = new Date(note.created_at);
  const hasText = Boolean(note.content.trim());
  const hasFiles = note.attachments.length > 0;
  const sharing = canShare();
  const wasEdited = note.updated_at !== note.created_at;
  const content = (
    <>
      {editing ? (
        <NoteEditor note={note} onClose={onCancelEdit} />
      ) : (
        <MessageMarkdown note={note} />
      )}
      <NoteAttachments attachments={note.attachments} />
      {wasEdited && !editing && <span className="edited-label">edited</span>}
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
            trigger={
              <button className="icon-button" aria-label="Note options">
                <MoreHorizontal size={17} />
              </button>
            }
          >
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
