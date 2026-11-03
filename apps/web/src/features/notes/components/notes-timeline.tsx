import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Button } from "../../../components/ui/button";
import type { Channel } from "../../workspaces/types";
import { useNotes } from "../hooks/use-notes";
import { useTimelineScroll } from "../hooks/use-timeline-scroll";
import { useNoteSelection } from "../hooks/use-note-selection";
import { notesApi } from "../api";
import type { Note } from "../types";
import type { ReminderSchedule } from "../../reminders/types";
import { ChannelIntro } from "./channel-intro";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { NoteComposer } from "./note-composer";
import { NoteList } from "./note-list";
import { OutgoingNotes } from "./outgoing-notes";

interface NotesTimelineProps {
  channel: Channel;
  targetId?: string;
  onReturnToLatest: () => void;
  onOpenThread?: (id: string) => void;
}

export function NotesTimeline({
  channel,
  targetId,
  onReturnToLatest,
  onOpenThread,
}: NotesTimelineProps) {
  const { query, notes, createNote, deleteNote } = useNotes(
    channel.id,
    targetId,
  );
  const scroll = useTimelineScroll(
    query.data,
    !targetId,
    targetId ? undefined : channel.id,
  );
  const highlighted = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [removing, setRemoving] = useState(false);
  const client = useQueryClient();
  const ids = useMemo(() => notes.map((note) => note.id), [notes]);
  const selection = useNoteSelection(ids, {
    copy: copySelected,
    remove: () => setDeletingSelected(true),
  });
  const count = selection.selected.size;
  const plural = `${count} ${count === 1 ? "message" : "messages"}`;

  function copySelected() {
    const text = notes
      .filter((note) => selection.selected.has(note.id))
      .map((note) => {
        const time = new Date(note.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        return `[${time}] ${note.content}`;
      })
      .join("\n");
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.success(`Copied ${plural}`);
        selection.clear();
      },
      () => toast.error("Couldn't copy to the clipboard."),
    );
  }

  async function deleteSelected() {
    setRemoving(true);
    const chosen = [...selection.selected];
    const results = await Promise.allSettled(
      chosen.map((id) => notesApi.remove(id)),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    await client.invalidateQueries({ queryKey: ["notes", channel.id] });
    void client.invalidateQueries({ queryKey: ["search"] });
    setRemoving(false);
    setDeletingSelected(false);
    selection.clear();
    if (failed)
      toast.error(`${failed} of ${chosen.length} couldn't be deleted.`);
    else toast.success(`Deleted ${plural}`);
  }

  useLayoutEffect(() => {
    if (!targetId || !query.data || highlighted.current) return;
    const note = document.getElementById(`note-${targetId}`);
    if (!note) return;
    note.dataset.highlighted = "true";
    note.scrollIntoView({ block: "center" });
    highlighted.current = true;
  }, [targetId, query.data]);

  async function sendNote(
    content: string,
    files: File[],
    reminder?: ReminderSchedule,
  ) {
    scroll.followLatestNotes();
    await createNote.mutateAsync({ content, files, reminder });
    scroll.jumpToLatest();
  }

  async function loadOlderNotes() {
    scroll.prepareForOlderNotes();
    const result = await query.fetchNextPage();
    if (result.isError) scroll.cancelOlderNotes();
  }

  function confirmDelete() {
    if (!noteToDelete) return;
    deleteNote.mutate(noteToDelete.id, {
      onSuccess: () => setNoteToDelete(null),
    });
  }

  function editLastNote() {
    const lastNote = notes[notes.length - 1];
    if (lastNote) setEditingId(lastNote.id);
  }

  return (
    <>
      <div
        className="timeline"
        ref={scroll.containerRef}
        onScroll={scroll.handleScroll}
        aria-label={`Notes in ${channel.name}`}
      >
        <div ref={scroll.contentRef}>
          {query.isPending ? (
            <div className="feed-loading">
              <LoaderCircle className="spin" size={21} />
              Opening your notes...
            </div>
          ) : query.isError ? (
            <div className="feed-loading" role="alert">
              <p>{query.error.message}</p>
              <Button variant="secondary" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {query.hasNextPage ? (
                <div className="load-older">
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={query.isFetchingNextPage}
                    onClick={() => void loadOlderNotes()}
                  >
                    {query.isFetchingNextPage ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <ArrowUp size={14} />
                    )}
                    Earlier notes
                  </Button>
                </div>
              ) : (
                <ChannelIntro channel={channel} isEmpty={notes.length === 0} />
              )}

              <NoteList
                channelName={channel.name}
                notes={notes}
                editingId={editingId}
                onEdit={setEditingId}
                onCancelEdit={() => setEditingId(null)}
                onDelete={setNoteToDelete}
                onOpenThread={onOpenThread}
                selection={selection}
                selectionTools={
                  <div
                    className="selection-tools"
                    role="toolbar"
                    aria-label="Selected messages"
                  >
                    <strong>{plural}</strong>
                    <button
                      className="icon-button"
                      aria-label="Copy selected messages"
                      onClick={copySelected}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Delete selected messages"
                      onClick={() => setDeletingSelected(true)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Clear selection"
                      onClick={selection.clear}
                    >
                      <X size={15} />
                    </button>
                  </div>
                }
              />
              {!query.hasPreviousPage && (
                <OutgoingNotes channelId={channel.id} />
              )}
              {query.hasPreviousPage && (
                <div className="load-older">
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={query.isFetchingPreviousPage}
                    onClick={() => void query.fetchPreviousPage()}
                  >
                    Later notes
                  </Button>
                </div>
              )}
              <div className="timeline-end" />
            </>
          )}
        </div>
      </div>

      <NoteComposer
        above={
          (targetId || !scroll.isAtBottom) && (
            <button
              className="jump-bottom"
              onClick={targetId ? onReturnToLatest : scroll.jumpToLatest}
            >
              <ArrowDown size={15} />
              Back to latest
            </button>
          )
        }
        channel={channel}
        isSending={createNote.isPending}
        onSend={sendNote}
        onEditLast={editLastNote}
        onSent={targetId ? onReturnToLatest : undefined}
      />
      <ConfirmDialog
        open={deletingSelected}
        pending={removing}
        title={`Delete ${plural}?`}
        description={`They'll be permanently removed from #${channel.name}.`}
        keepLabel="Keep"
        confirmLabel={`Delete ${plural}`}
        onClose={() => setDeletingSelected(false)}
        onConfirm={() => void deleteSelected()}
      />
      <DeleteNoteDialog
        open={noteToDelete !== null}
        pending={deleteNote.isPending}
        onClose={() => setNoteToDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
