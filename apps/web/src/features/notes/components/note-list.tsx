import type { Note } from "../types";
import { useAppearance } from "../../settings/appearance-context";
import { noteGrouping } from "../grouping";
import { NoteCard } from "./note-card";

interface NoteListProps {
  channelName: string;
  notes: Note[];
  editingId: string | null;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (note: Note) => void;
}

export function NoteList({
  channelName,
  notes,
  editingId,
  onEdit,
  onCancelEdit,
  onDelete,
}: NoteListProps) {
  const { preferences } = useAppearance();
  return (
    <div className={`notes-list layout-${preferences.messageLayout}`}>
      {notes.map((note, index) => {
        const createdAt = new Date(note.created_at);
        const previousNote = notes[index - 1];
        const { startsNewDay, startsGroup, startsMinute } = noteGrouping(
          note.created_at,
          previousNote?.created_at,
        );
        const timeLabel = createdAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const showMarker =
          preferences.messageLayout === "minute"
            ? startsMinute
            : preferences.messageLayout === "connected" && startsGroup;
        const dateLabel = createdAt.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        return (
          <div
            key={note.id}
            className={`note-entry ${startsGroup ? "note-group-start" : "note-group-follow"} ${startsNewDay ? "note-day-start" : ""}`}
          >
            {startsNewDay && (
              <div className="date-divider">
                <span>{dateLabel}</span>
              </div>
            )}
            {showMarker && (
              <time
                className="note-minute-marker"
                dateTime={note.created_at}
                title={createdAt.toLocaleString()}
              >
                {timeLabel}
              </time>
            )}
            <NoteCard
              channelName={channelName}
              note={note}
              editing={editingId === note.id}
              onEdit={() => onEdit(note.id)}
              onCancelEdit={onCancelEdit}
              onDelete={() => onDelete(note)}
            />
          </div>
        );
      })}
    </div>
  );
}
