import type { ReactNode } from "react";
import type { Note } from "../types";
import type { NoteSelection } from "../hooks/use-note-selection";
import type { AiPreview } from "../../ai/assistant/types";
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
  onOpenThread?: (id: string) => void;
  onAskAi?: (note: Note, anchor: HTMLElement) => void;
  /** Adds the selection gutter; `selectionTools` shows beside the first selected note. */
  selection?: NoteSelection;
  selectionTools?: ReactNode;
  /** Rewrites shown on messages before they're applied. */
  preview?: AiPreview | null;
}

export function NoteList({
  channelName,
  notes,
  editingId,
  onEdit,
  onCancelEdit,
  onDelete,
  onOpenThread,
  onAskAi,
  selection,
  selectionTools,
  preview,
}: NoteListProps) {
  const { preferences } = useAppearance();
  const firstSelected = selection
    ? notes.find((note) => selection.selected.has(note.id))?.id
    : undefined;
  return (
    <div className={`notes-list layout-${preferences.messageLayout}`}>
      {notes.map((note, index) => {
        const createdAt = new Date(note.created_at);
        const previousNote = notes[index - 1];
        const { startsNewDay, startsGroup } = noteGrouping(
          note.created_at,
          previousNote?.created_at,
          preferences.messageGroupMinutes,
        );
        const timeLabel = createdAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const showMarker =
          startsGroup &&
          (preferences.messageLayout === "minute" ||
            preferences.messageLayout === "connected");
        const dateLabel = createdAt.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        return (
          <div
            key={note.id}
            className={`note-entry ${startsGroup ? "note-group-start" : "note-group-follow"} ${startsNewDay ? "note-day-start" : ""}${selection?.selected.has(note.id) ? " note-selected" : ""}`}
            data-note-id={selection ? note.id : undefined}
            onPointerDown={(event) => {
              if (
                selection &&
                (event.target as HTMLElement).closest(
                  ".note-time, .note-minute-marker",
                )
              )
                selection.press(note.id, event);
            }}
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
            {selection && (
              <span
                className="note-gutter"
                role="checkbox"
                aria-checked={selection.selected.has(note.id)}
                aria-label={`Select note from ${timeLabel}`}
                tabIndex={-1}
                onPointerDown={(event) => selection.press(note.id, event)}
              />
            )}
            {note.id === firstSelected && selectionTools}
            <NoteCard
              channelName={channelName}
              note={note}
              editing={editingId === note.id}
              preview={preview?.get(note.id)}
              onEdit={() => onEdit(note.id)}
              onCancelEdit={onCancelEdit}
              onDelete={() => onDelete(note)}
              onOpenThread={
                onOpenThread ? () => onOpenThread(note.id) : undefined
              }
              onAskAi={onAskAi ? (anchor) => onAskAi(note, anchor) : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
