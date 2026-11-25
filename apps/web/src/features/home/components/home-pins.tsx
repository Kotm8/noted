import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { liveInterval } from "../../../lib/live";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { Button } from "../../../components/ui/button";
import { notesApi } from "../../notes/api";
import { documentApi } from "../../notes/documents/api";
import { journalsApi } from "../../journals/api";
import { ChannelIcon } from "../../workspaces/components/channel-icon";
import { channelApi } from "../../workspaces/api";
import { useWorkspaceShell } from "../../workspaces/shell-context";
import type { Channel } from "../../workspaces/types";

function PinnedRow({ channel }: { channel: Channel }) {
  const shell = useWorkspaceShell();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const kind = channel.kind;
  const prefix =
    kind === "journal"
      ? "journals"
      : kind === "document"
        ? "channel-document"
        : "notes";
  const preview = useQuery({
    queryKey: [prefix, channel.id, "home-preview"],
    queryFn: async () => {
      if (kind === "journal")
        return (
          (await journalsApi.list(channel.id))[0]?.title ?? "No entries yet"
        );
      if (kind === "document")
        return (
          (await documentApi(channel.name).get(channel.id)).content ||
          "Empty note"
        );
      const page = await notesApi.list(channel.id, {});
      const note = [...page.items].sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
      )[0];
      return (
        note?.content ||
        (note?.attachments.length
          ? note.attachments[0].original_filename
          : "No messages yet")
      );
    },
    refetchInterval: () => liveInterval(30000),
  });
  return (
    <>
      <div className="home-pin-row">
        <ChannelIcon kind={kind} size={16} />
        <button
          onClick={() => shell.openChannel(channel.workspace_id, channel.id)}
        >
          <span>
            {channel.name}
            <small>
              {
                shell.navigation.workspaces.find(
                  (item) => item.id === channel.workspace_id,
                )?.name
              }
            </small>
          </span>
          <small className="home-pin-preview">
            {preview.isPending
              ? "Loading preview…"
              : preview.error
                ? "Open channel"
                : preview.data}
          </small>
        </button>
        {kind === "journal" && (
          <button
            className="icon-button home-new-entry"
            aria-label={`New entry in ${channel.name}`}
            onClick={() => setCreating(true)}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      {creating && (
        <Modal
          open
          title="New journal entry"
          description={`#${channel.name}`}
          onOpenChange={(open) => {
            if (!pending) setCreating(open);
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending || !title.trim()) return;
              setPending(true);
              setError("");
              try {
                const entry = await journalsApi.create(
                  channel.id,
                  title.trim(),
                );
                client.setQueryData(["journal-entry", entry.id], entry);
                void client.invalidateQueries({
                  queryKey: ["journals", channel.id],
                });
                shell.openPage(
                  `/w/${channel.workspace_id}/c/${channel.id}?entry=${entry.id}`,
                );
                shell.setWriting({
                  kind: "journal",
                  id: entry.id,
                  channelId: channel.id,
                  editing: true,
                });
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setPending(false);
              }
            }}
          >
            <label>
              Title
              <input
                autoFocus
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="dialog-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                Create entry
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function HomePins({ compact = false }: { compact?: boolean }) {
  const query = useQuery({
    queryKey: ["channels", "all"],
    queryFn: channelApi.listAll,
  });
  const channels = query.data;
  const pins =
    channels
      ?.filter((channel) => channel.pinned_at)
      .sort((a, b) => Date.parse(a.pinned_at!) - Date.parse(b.pinned_at!)) ??
    [];
  if (compact && !pins.length) return null;
  return (
    <section
      className="home-b-section home-b-pins"
      aria-label="Pinned channels"
    >
      <div className="home-b-section-heading">
        <h2>Pinned</h2>
      </div>
      {query.error ? (
        <Notice tone="error">
          {query.error.message}
          <button onClick={() => void query.refetch()}>Retry</button>
        </Notice>
      ) : !channels ? (
        <p className="home-empty">Loading pinned channels…</p>
      ) : !pins.length ? (
        <p className="home-empty">
          Pin a channel from its sidebar menu to keep it here.
        </p>
      ) : (
        pins.map((channel) => <PinnedRow channel={channel} key={channel.id} />)
      )}
    </section>
  );
}
