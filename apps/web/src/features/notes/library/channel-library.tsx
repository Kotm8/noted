import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, Link as LinkIcon } from "lucide-react";
import { request } from "../../../lib/http";
import { liveInterval } from "../../../lib/live";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { NoteAttachments } from "../components/note-attachments";
import type { Attachment } from "../types";
import "./library.css";

type Item = {
  id: string;
  thread_root_id: string | null;
  content: string;
  created_at: string;
  attachments: Attachment[];
  links: string[];
};
type Page = { items: Item[]; next_offset: number | null };

export function ChannelLibrary({
  channelId,
  onOpen,
}: {
  channelId: string;
  onOpen: (id: string, root: string | null) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["channel-library", channelId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      request<Page>(`/channels/${channelId}/library?offset=${pageParam}`),
    getNextPageParam: (page) => page.next_offset ?? undefined,
    refetchInterval: () => liveInterval(30000),
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="channel-library" aria-label="Files and links">
      {query.isPending && <p role="status">Loading files and links...</p>}
      {query.isError && (
        <Notice tone="error">
          {query.error.message}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </Notice>
      )}
      {!query.isPending && !query.isError && !items.length && (
        <p className="settings-hint">
          Files and links shared in this channel and its threads will appear
          here.
        </p>
      )}
      {items.map((item) => (
        <article className="library-item" key={item.id}>
          <header>
            <time dateTime={item.created_at}>
              {new Date(item.created_at).toLocaleString()}
            </time>
            <Button
              variant="ghost"
              size="small"
              onClick={() => onOpen(item.id, item.thread_root_id)}
            >
              {item.thread_root_id ? "Open reply" : "Open message"}
              <ArrowUpRight size={14} />
            </Button>
          </header>
          <NoteAttachments attachments={item.attachments} />
          {item.links.map((link) => (
            <a
              className="library-link"
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              key={link}
            >
              <LinkIcon size={16} />
              <span>{link}</span>
              <ArrowUpRight size={14} />
            </a>
          ))}
        </article>
      ))}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
