import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { NoteAttachments } from "./note-attachments";
import type { Note } from "../types";
import { Markdown } from "./markdown";
import { NoteEditor } from "./note-editor";
import { ReminderMessage } from "../../reminders/components/reminder-message";
import { CopyNoteButton } from "./copy-note-button";

interface NoteCardProps {
  channelName: string;
  note: Note;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

export function NoteCard({
  channelName,
  note,
  editing,
  onEdit,
  onCancelEdit,
  onDelete,
}: NoteCardProps) {
  const createdAt = new Date(note.created_at);
  const wasEdited = note.updated_at !== note.created_at;
  const content = (
    <>
      {editing ? (
        <NoteEditor note={note} onClose={onCancelEdit} />
      ) : (
        <Markdown content={note.content} />
      )}
      <NoteAttachments attachments={note.attachments} />
      {wasEdited && !editing && <span className="edited-label">edited</span>}
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
