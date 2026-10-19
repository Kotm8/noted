import { useLayoutEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { WritingSidebar } from "../../components/ui/writing-sidebar";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { threadsApi } from "./api";
import { NoteList } from "../notes/components/note-list";
import { MessageMarkdown } from "../notes/components/message-markdown";
import { NoteAttachments } from "../notes/components/note-attachments";
import { DeleteNoteDialog } from "../notes/components/delete-note-dialog";
import { useTimelineScroll } from "../notes/hooks/use-timeline-scroll";
import { useDraft } from "../notes/hooks/use-draft";
import { notesApi } from "../notes/api";
import type { Channel } from "../workspaces/types";
import type { Note, NoteCursor } from "../notes/types";

export function ThreadSidebar({
  rootId,
  channel,
  onClose,
  targetId,
  onReturnToLatest,
}: {
  rootId: string;
  channel: Channel;
  onClose: () => void;
  targetId?: string;
  onReturnToLatest?: () => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const { draft, setDraft, clearSentDraft } = useDraft(`thread.${rootId}`);
  const query = useInfiniteQuery({
    queryKey: ["thread", rootId, targetId ?? "latest"],
    queryFn: ({ pageParam }) => threadsApi.read(rootId, pageParam),
    initialPageParam: (targetId ? { around: targetId } : {}) as NoteCursor,
    getNextPageParam: (page): NoteCursor | undefined =>
      page.replies.next_cursor
        ? { before: page.replies.next_cursor }
        : undefined,
    getPreviousPageParam: (page): NoteCursor | undefined =>
      page.replies.newer_cursor
        ? { after: page.replies.newer_cursor }
        : undefined,
    refetchInterval: 15000,
  });
  const scroll = useTimelineScroll(query.data, !targetId);
  const highlighted = useRef(false);
  useLayoutEffect(() => {
    if (!targetId || !query.data || highlighted.current) return;
    const note = scroll.containerRef.current?.querySelector<HTMLElement>(
      `[id="note-${CSS.escape(targetId)}"]`,
    );
    if (note) {
      note.dataset.highlighted = "true";
      note.scrollIntoView({ block: "center" });
      highlighted.current = true;
    }
  }, [targetId, query.data, scroll.containerRef]);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["thread", rootId] }),
      client.invalidateQueries({ queryKey: ["notes", channel.id] }),
      client.invalidateQueries({ queryKey: ["search"] }),
    ]);
  const send = useMutation({
    mutationFn: (content: string) => threadsApi.reply(rootId, content),
    onSuccess: async (_note, content) => {
      clearSentDraft(content);
      await refresh();
      if (targetId) onReturnToLatest?.();
      else scroll.jumpToLatest();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => notesApi.remove(id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const root = query.data?.pages[0]?.root;
  const replies =
    query.data?.pages
      .slice()
      .reverse()
      .flatMap((page) => page.replies.items) ?? [];
  function submit() {
    if (!draft.trim() || send.isPending) return;
    scroll.followLatestNotes();
    send.mutate(draft);
  }
  return (
    <WritingSidebar title={`Thread · #${channel.name}`} onClose={onClose}>
      {query.isPending ? (
        <div className="feed-loading">
          <LoaderCircle size={19} className="animate-spin" />
        </div>
      ) : query.isError ? (
        <Notice tone="error">
          {query.error.message}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Notice>
      ) : (
        root && (
          <>
            <div className="thread-source">
              <time dateTime={root.created_at}>
                {new Date(root.created_at).toLocaleString()}
              </time>
              <MessageMarkdown note={root} />
              <NoteAttachments attachments={root.attachments} />
            </div>
            <div
              className="thread-replies"
              ref={scroll.containerRef}
              onScroll={scroll.handleScroll}
            >
              <div ref={scroll.contentRef}>
                {query.hasNextPage && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={query.isFetchingNextPage}
                    onClick={async () => {
                      scroll.prepareForOlderNotes();
                      const result = await query.fetchNextPage();
                      if (result.isError) scroll.cancelOlderNotes();
                    }}
                  >
                    Earlier replies
                  </Button>
                )}
                <span className="thread-reply-count">
                  {root.reply_count ?? replies.length}{" "}
                  {(root.reply_count ?? replies.length) === 1
                    ? "reply"
                    : "replies"}
                </span>
                {!replies.length && (
                  <p className="settings-hint">No replies yet.</p>
                )}
                <NoteList
                  channelName={channel.name}
                  notes={replies}
                  editingId={editing}
                  onEdit={setEditing}
                  onCancelEdit={() => setEditing(null)}
                  onDelete={setDeleting}
                />
                {query.hasPreviousPage && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={query.isFetchingPreviousPage}
                    onClick={() => void query.fetchPreviousPage()}
                  >
                    Later replies
                  </Button>
                )}
              </div>
            </div>
            {targetId && (
              <Button variant="ghost" size="small" onClick={onReturnToLatest}>
                Back to latest replies
              </Button>
            )}
            <form
              className="thread-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <textarea
                autoFocus
                aria-label="Thread reply"
                placeholder="Continue this thought…"
                value={draft}
                maxLength={40000}
                rows={1}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(180, event.target.scrollHeight)}px`;
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                className="thread-send"
                type="submit"
                aria-label="Send reply"
                disabled={!draft.trim() || send.isPending}
              >
                {send.isPending ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <ArrowUp size={18} />
                )}
              </button>
            </form>
          </>
        )
      )}
      <DeleteNoteDialog
        open={deleting !== null}
        pending={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </WritingSidebar>
  );
}
