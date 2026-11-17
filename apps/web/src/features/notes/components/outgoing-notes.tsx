import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  CloudOff,
  LoaderCircle,
  Paperclip,
  RotateCw,
  Trash2,
} from "lucide-react";
import { formatFileSize } from "../../../lib/format";
import { discard, retry, useOutbox } from "../outbox";
import { Markdown } from "./markdown";
import { ContextMenu } from "../../../components/ui/context-menu";
import { MenuItem } from "../../../components/ui/menu";
import { copyText } from "../../../lib/clipboard";
import type { NotePage } from "../types";
import type { ThreadPage } from "../../threads/api";

/** Messages written without a connection, shown at the end of the channel until they send. */
export function OutgoingNotes({
  channelId,
  threadRootId,
}: {
  channelId: string;
  threadRootId?: string;
}) {
  const queued = useOutbox(channelId, threadRootId);
  const client = useQueryClient();
  const data = threadRootId
    ? client.getQueryData<InfiniteData<ThreadPage>>([
        "thread",
        threadRootId,
        "latest",
      ])
    : client.getQueryData<InfiniteData<NotePage>>([
        "notes",
        channelId,
        "latest",
      ]);
  const delivered = new Set(
    data?.pages
      .flatMap((page) => ("replies" in page ? page.replies.items : page.items))
      .map((note) => note.client_id)
      .filter(Boolean),
  );
  const waiting = queued.filter((item) => !delivered.has(item.clientId));
  if (!waiting.length) return null;
  return (
    <div className="outgoing-notes">
      {waiting.map((item) => (
        <ContextMenu
          key={item.clientId}
          label="Outgoing message actions"
          menu={
            <>
              {item.content && (
                <MenuItem onSelect={() => void copyText(item.content)}>
                  Copy text
                </MenuItem>
              )}
              {item.error && (
                <MenuItem onSelect={() => retry(client, item.clientId)}>
                  <RotateCw size={14} />
                  Retry
                </MenuItem>
              )}
              <MenuItem
                danger
                disabled={item.sending}
                onSelect={() => discard(item.clientId)}
              >
                <Trash2 size={14} />
                {item.error ? "Delete" : "Discard"}
              </MenuItem>
            </>
          }
        >
          <article
            className={`note outgoing-note${item.error ? " outgoing-failed" : ""}`}
            aria-label={
              item.error
                ? "Message that couldn't send"
                : "Message waiting to send"
            }
          >
            <span className="note-time" aria-hidden="true">
              {item.sending ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <CloudOff size={13} />
              )}
            </span>
            <div className="note-main">
              {item.content && <Markdown content={item.content} />}
              {item.files && (
                <ul className="outgoing-files">
                  {item.files.map((file, index) => (
                    <li key={index}>
                      <Paperclip size={12} />
                      {file.name}
                      <small>{formatFileSize(file.size)}</small>
                    </li>
                  ))}
                </ul>
              )}
              <span className="outgoing-status" role="status">
                {item.error
                  ? `Couldn't send: ${item.error}`
                  : item.sending
                    ? "Sending…"
                    : "Waiting to send"}
                {item.error && (
                  <button
                    type="button"
                    onClick={() => retry(client, item.clientId)}
                  >
                    <RotateCw size={12} />
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  disabled={item.sending}
                  onClick={() => discard(item.clientId)}
                >
                  <Trash2 size={12} />
                  {item.error ? "Delete" : "Discard"}
                </button>
              </span>
            </div>
          </article>
        </ContextMenu>
      ))}
    </div>
  );
}
