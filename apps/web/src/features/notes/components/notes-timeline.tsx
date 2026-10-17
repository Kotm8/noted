import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { Channel } from "../../workspaces/types";
import { useNotes } from "../hooks/use-notes";
import { useTimelineScroll } from "../hooks/use-timeline-scroll";
import type { Note } from "../types";
import type { ReminderSchedule } from "../../reminders/types";
import { ChannelIntro } from "./channel-intro";
import { DeleteNoteDialog } from "./delete-note-dialog";
import { NoteComposer } from "./note-composer";
import { NoteList } from "./note-list";

interface NotesTimelineProps {
  channel: Channel;
  targetId?: string;
  onReturnToLatest: () => void;
}

export function NotesTimeline({
  channel,
  targetId,
  onReturnToLatest,
}: NotesTimelineProps) {
  const { query, notes, createNote, deleteNote } = useNotes(
    channel.id,
    targetId,
  );
  const scroll = useTimelineScroll(query.data, !targetId);
  const highlighted = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);

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
              <LoaderCircle className="animate-spin" size={21} />
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
                      <LoaderCircle className="animate-spin" size={14} />
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
              />
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

      {(targetId || !scroll.isAtBottom) && (
        <button
          className="jump-bottom"
          onClick={targetId ? onReturnToLatest : scroll.jumpToLatest}
        >
          <ArrowDown size={15} />
          Back to latest
        </button>
      )}
      <NoteComposer
        channel={channel}
        isSending={createNote.isPending}
        onSend={sendNote}
        onEditLast={editLastNote}
        onSent={targetId ? onReturnToLatest : undefined}
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
