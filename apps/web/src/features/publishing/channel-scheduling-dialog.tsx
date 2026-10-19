import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import type { Channel } from "../workspaces/types";
import { publishingApi } from "./api";
import { ScheduleMessageDialog } from "./schedule-message-dialog";
import { WritingPromptForm } from "./writing-prompt-form";
import type { ScheduledMessage } from "./types";

export function ChannelSchedulingDialog({
  channel,
  initialTab,
  onClose,
}: {
  channel: Channel;
  initialTab: "messages" | "writing";
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const client = useQueryClient();
  const messages = useQuery({
    queryKey: ["publishing", "messages", channel.id],
    queryFn: () => publishingApi.list(channel.id),
    enabled: tab === "messages",
    refetchInterval: 10000,
  });
  const writing = useQuery({
    queryKey: ["publishing", "writing", channel.id],
    queryFn: () => publishingApi.writing(channel.id),
    enabled: tab === "writing",
  });
  const cancel = useMutation({
    mutationFn: (item: ScheduledMessage) =>
      publishingApi.cancel(item.id, item.revision),
    onSuccess: () => client.invalidateQueries({ queryKey: ["publishing"] }),
    onError: (error) => toast.error(error.message),
  });
  const active = tab === "messages" ? messages : writing;
  return (
    <>
      <Modal
        open
        title={`#${channel.name}`}
        description="Channel scheduling"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        className="publishing-dialog"
      >
        <div
          className="publishing-tabs"
          role="tablist"
          aria-label="Channel scheduling"
        >
          {channel.kind === "note" && (
            <button
              role="tab"
              aria-selected={tab === "messages"}
              onClick={() => setTab("messages")}
            >
              Scheduled messages
            </button>
          )}
          <button
            role="tab"
            aria-selected={tab === "writing"}
            onClick={() => setTab("writing")}
          >
            Writing prompt
          </button>
        </div>
        {active.isPending && <p role="status">Loading…</p>}
        {active.error && (
          <Notice tone="error">
            {active.error.message}
            <button type="button" onClick={() => void active.refetch()}>
              Retry
            </button>
          </Notice>
        )}
        {tab === "messages" && messages.data && (
          <div className="scheduled-message-list">
            {!messages.data.length && (
              <p className="field-caption">
                Nothing scheduled yet. Use the clock beside Send to send a
                message later.
              </p>
            )}
            {messages.data.map((item) => (
              <article className="scheduled-message-item" key={item.id}>
                <div>
                  <span>
                    <Clock3 size={13} />
                    <time dateTime={item.send_at}>
                      {new Date(item.send_at).toLocaleString()}
                    </time>
                    <small>
                      {item.status === "pending"
                        ? "Scheduled"
                        : item.status === "skipped"
                          ? "Skipped"
                          : item.status === "sent"
                            ? "Sent"
                            : "Cancelled"}
                    </small>
                  </span>
                  <p>{item.content}</p>
                  {item.status === "skipped" && (
                    <small>
                      The server was unavailable at the scheduled time, or the
                      channel type changed.
                    </small>
                  )}
                </div>
                {item.status === "pending" && (
                  <div className="scheduled-message-actions">
                    <button
                      className="icon-button"
                      aria-label="Edit scheduled message"
                      onClick={() => setEditing(item)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Cancel scheduled message"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(item)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {tab === "writing" && writing.data !== undefined && (
          <WritingPromptForm channelId={channel.id} initial={writing.data} />
        )}
      </Modal>
      {editing && (
        <ScheduleMessageDialog
          channelId={channel.id}
          channelName={channel.name}
          content={editing.content}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
