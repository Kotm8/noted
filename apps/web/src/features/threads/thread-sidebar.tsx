import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowUp,
  CaseSensitive,
  LoaderCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import { useFormatting, useFormattingVisible } from "../writing/use-formatting";
import { toast } from "sonner";
import { WritingSidebar } from "../../components/ui/writing-sidebar";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { NoteList } from "../notes/components/note-list";
import { MessageMarkdown } from "../notes/components/message-markdown";
import { NoteAttachments } from "../notes/components/note-attachments";
import { DeleteNoteDialog } from "../notes/components/delete-note-dialog";
import { OutgoingNotes } from "../notes/components/outgoing-notes";
import { enqueue, flushOutbox } from "../notes/outbox";
import { useTimelineScroll } from "../notes/hooks/use-timeline-scroll";
import { useDraft } from "../notes/hooks/use-draft";
import { notesApi } from "../notes/api";
import type { Channel } from "../workspaces/types";
import type { Note } from "../notes/types";
import { chatEnter } from "../notes/chat-enter";
import { useMentionPicker } from "../notes/components/mention-picker";
import { toStored } from "../notes/mentions";
import { threadQuery } from "./queries";
import { useOptionalAssistant } from "../ai/assistant/context";
import { askAboutMessages } from "../ai/assistant/use-assistant";
import { useAiStatus } from "../ai/queries";
import { useComposerFiles } from "../notes/hooks/use-composer-files";
import { PendingFiles } from "../notes/components/pending-files";

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
  const { draft, setDraft, clearSentDraft, ready } = useDraft(
    `thread.${rootId}`,
  );
  const assistant = useOptionalAssistant();
  const aiConnected = useAiStatus().data?.connected ?? false;
  const ask = (chosen: Note[]) =>
    askAboutMessages({
      channelId: channel.id,
      channelName: channel.name,
      workspaceId: channel.workspace_id,
      notes: chosen
        .slice(0, 100)
        .map((note) => ({ id: note.id, content: note.content })),
      threadRootId: rootId,
    });
  useEffect(() => {
    const draft = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.threadRootId === rootId)
        setDraft((current) =>
          [current, detail.text].filter(Boolean).join("\n\n"),
        );
    };
    window.addEventListener("noted:assistant-draft", draft);
    return () => window.removeEventListener("noted:assistant-draft", draft);
  }, [rootId, setDraft]);
  const query = useInfiniteQuery(threadQuery(rootId, targetId));
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
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { files, setFiles, addFiles, filesLoading } = useComposerFiles(
    `thread.${rootId}`,
  );
  const mentions = useMentionPicker(replyRef, draft);
  const formatting = useFormatting(replyRef);
  const [formattingVisible, toggleFormatting] = useFormattingVisible();
  const send = useMutation({
    networkMode: "always",
    mutationFn: async ({
      content,
      files,
    }: {
      content: string;
      files: File[];
    }) => {
      const stored = toStored(content, mentions.refs.current);
      const clientId = crypto.randomUUID();
      await enqueue(
        {
          clientId,
          channelId: channel.id,
          content: stored,
          threadRootId: rootId,
        },
        files,
      );
      void flushOutbox(client);
    },
    onSuccess: async (_, { content }) => {
      clearSentDraft(content);
      setFiles([]);
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
    if (
      !ready ||
      filesLoading ||
      (!draft.trim() && !files.length) ||
      send.isPending
    )
      return;
    scroll.followLatestNotes();
    send.mutate({ content: draft, files: [...files] });
  }
  return (
    <WritingSidebar title={`Thread · #${channel.name}`} onClose={onClose}>
      {query.isPending ? (
        <div className="feed-loading">
          <LoaderCircle size={19} className="spin" />
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
              {aiConnected && (
                <button
                  type="button"
                  className="ask-ai-button thread-ask-ai"
                  title="The assistant reads this thread and replies in it"
                  onClick={() => ask([root, ...replies])}
                >
                  <Sparkles size={14} />
                  Ask AI in this thread
                </button>
              )}
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
                  onAskAi={aiConnected ? (note) => ask([note]) : undefined}
                  preview={assistant?.preview}
                />
                {!query.hasPreviousPage && (
                  <OutgoingNotes channelId={channel.id} threadRootId={rootId} />
                )}
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
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files"))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                if (
                  send.isPending ||
                  filesLoading ||
                  !event.dataTransfer.files.length
                )
                  return;
                event.preventDefault();
                addFiles(Array.from(event.dataTransfer.files));
              }}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {mentions.menu}
              {formattingVisible && formatting.toolbar}
              <PendingFiles
                files={files}
                disabled={send.isPending || filesLoading}
                onRemove={(index) =>
                  setFiles((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              />
              <input
                ref={fileInputRef}
                hidden
                type="file"
                multiple
                aria-label="Attach reply files"
                disabled={send.isPending || filesLoading}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                className="icon-button"
                type="button"
                aria-label="Add reply files"
                title="Add files"
                disabled={send.isPending || filesLoading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={18} />
              </button>
              <textarea
                ref={replyRef}
                autoFocus
                aria-label="Thread reply"
                placeholder="Reply in thread"
                value={draft}
                readOnly={!ready}
                maxLength={40000}
                rows={1}
                onChange={(event) => {
                  setDraft(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(180, event.target.scrollHeight)}px`;
                }}
                onSelect={mentions.onSelect}
                onPaste={(event) => {
                  const pasted = Array.from(event.clipboardData.files);
                  if (pasted.length && !send.isPending && !filesLoading) {
                    event.preventDefault();
                    addFiles(pasted);
                  }
                }}
                onKeyDown={(event) => {
                  if (mentions.onKeyDown(event) || formatting.onKeyDown(event))
                    return;
                  chatEnter(event, submit);
                }}
              />
              <button
                className="icon-button composer-format-toggle"
                type="button"
                aria-label={
                  formattingVisible ? "Hide formatting" : "Show formatting"
                }
                title={
                  formattingVisible ? "Hide formatting" : "Show formatting"
                }
                aria-pressed={formattingVisible}
                onClick={toggleFormatting}
              >
                <CaseSensitive size={18} />
              </button>
              <button
                className="thread-send"
                type="submit"
                aria-label="Send reply"
                disabled={
                  filesLoading ||
                  (!draft.trim() && !files.length) ||
                  send.isPending
                }
              >
                {send.isPending ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowUp size={18} />
                )}
              </button>
            </form>
            {formatting.dialog}
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
