import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { journalsApi } from "./api";
import type { Channel } from "../workspaces/types";

export function JournalList({
  channel,
  selectedId,
  onSelect,
}: {
  channel: Channel;
  selectedId?: string;
  onSelect: (id: string, editing?: boolean) => void;
}) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["journals", channel.id],
    queryFn: ({ pageParam }) => journalsApi.list(channel.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, offset) =>
      lastPage.length === 50 ? offset + 50 : undefined,
    refetchInterval: 15000,
  });
  const create = useMutation({
    mutationFn: () => journalsApi.create(channel.id, title),
    onSuccess: async (entry) => {
      client.setQueryData(["journal-entry", entry.id], entry);
      await client.invalidateQueries({ queryKey: ["journals", channel.id] });
      setCreating(false);
      setTitle("");
      onSelect(entry.id, true);
    },
  });
  const entries = query.data?.pages.flat() ?? [];
  return (
    <>
      <div className="journal-list-heading">
        <h2>Your entries</h2>
        <Button size="small" variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={15} />
          New entry
        </Button>
      </div>
      <div className="journal-entries">
        {query.isPending && <p className="settings-hint">Opening entries…</p>}
        {query.isError && (
          <Notice tone="error">
            {query.error.message}
            <Button variant="ghost" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </Notice>
        )}
        {!query.isPending && !query.isError && !entries.length && (
          <p className="settings-hint">
            Create a named entry, then open it to write.
          </p>
        )}
        {entries.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className="journal-entry-row"
            aria-current={selectedId === entry.id ? "page" : undefined}
            onClick={() => onSelect(entry.id)}
          >
            <span>
              <FileText size={15} />
              {entry.title}
            </span>
            <time dateTime={entry.created_at}>
              {new Date(entry.created_at).toLocaleDateString()}
            </time>
          </button>
        ))}
        {query.hasNextPage && (
          <Button
            variant="ghost"
            size="small"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Earlier entries
          </Button>
        )}
      </div>
      <Modal
        open={creating}
        onOpenChange={(open) => {
          if (!create.isPending) setCreating(open);
        }}
        title="New journal entry"
        description="Give this entry a name, then write inside it."
      >
        <form
          className="management-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !create.isPending) create.mutate();
          }}
        >
          <label>
            Entry name
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {create.error && <Notice tone="error">{create.error.message}</Notice>}
          <div className="dialog-actions">
            <Button
              variant="ghost"
              type="button"
              disabled={create.isPending}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !title.trim()}>
              Create entry
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
