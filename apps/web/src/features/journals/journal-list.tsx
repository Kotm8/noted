import { ContextMenu } from "../../components/ui/context-menu";
import { MenuItem } from "../../components/ui/menu";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { copyText } from "../../lib/clipboard";
import { toast } from "sonner";
import type { JournalEntry } from "./types";
import { useState, type MouseEvent } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, FileText, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { journalsApi } from "./api";
import { journalsQuery } from "./queries";
import type { Channel } from "../workspaces/types";
import { useJournalLookBack } from "../ai/writing/use-journal-look-back";

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
  const [removing, setRemoving] = useState<JournalEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const query = useInfiniteQuery(journalsQuery(channel.id));
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
  const remove = useMutation({
    mutationFn: (entry: JournalEntry) =>
      journalsApi.remove(entry.id, entry.revision),
    onSuccess: async () => {
      setRemoving(null);
      await client.invalidateQueries({ queryKey: ["journals", channel.id] });
      await client.invalidateQueries({ queryKey: ["search"] });
    },
    onError: (error) => toast.error(error.message),
  });
  const entries = query.data?.pages.flat() ?? [];
  const ai = useJournalLookBack({ channel, entries, onSelect });
  const createFromEmptySpace = (event: MouseEvent) => {
    if (event.target === event.currentTarget && !getSelection()?.toString())
      setCreating(true);
  };
  return (
    <>
      <div className="journal-list-heading" onClick={createFromEmptySpace}>
        <h2>Your entries</h2>
        {ai.button}
        <Button size="small" variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={15} />
          New entry
        </Button>
      </div>
      <div className="journal-entries" onClick={createFromEmptySpace}>
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
            Click anywhere to start a named entry, then write inside it.
          </p>
        )}
        {entries.map((entry) => (
          <ContextMenu
            key={entry.id}
            label={`Actions for journal ${entry.title}`}
            menu={
              <>
                <MenuItem onSelect={() => onSelect(entry.id)}>
                  Open entry
                </MenuItem>
                <MenuItem onSelect={() => onSelect(entry.id, true)}>
                  Edit entry
                </MenuItem>
                <MenuItem
                  onSelect={() =>
                    void journalsApi
                      .get(entry.id)
                      .then((full) =>
                        copyText(`${full.title}\n\n${full.content}`),
                      )
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  Copy text
                </MenuItem>
                <MenuItem
                  danger
                  onSelect={() =>
                    void journalsApi
                      .get(entry.id)
                      .then(setRemoving)
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  Delete entry
                </MenuItem>
              </>
            }
          >
            <button
              type="button"
              className={`journal-entry-row${ai.marked.has(entry.id) ? " ai-entry-selected" : ""}`}
              aria-current={selectedId === entry.id ? "page" : undefined}
              onClick={() => {
                if (!ai.toggle(entry.id)) onSelect(entry.id);
              }}
            >
              <span>
                {ai.picking && (
                  <span
                    role="checkbox"
                    aria-label={`Include ${entry.title}`}
                    aria-checked={ai.marked.has(entry.id)}
                    className="ai-entry-checkbox"
                  >
                    {ai.marked.has(entry.id) && <Check size={12} />}
                  </span>
                )}
                <FileText size={15} />
                {entry.title}
              </span>
              <time dateTime={entry.created_at}>
                {new Date(entry.created_at).toLocaleDateString()}
              </time>
            </button>
          </ContextMenu>
        ))}
        {query.hasNextPage && (
          <Button
            variant="ghost"
            size="small"
            disabled={query.isFetchingNextPage}
            data-ai-load-entries
            onClick={() => void query.fetchNextPage()}
          >
            Earlier entries
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        pending={remove.isPending}
        title="Delete journal entry"
        description={`Permanently delete ${removing?.title ?? "this entry"}?`}
        keepLabel="Keep entry"
        confirmLabel="Delete entry"
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
      />
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
