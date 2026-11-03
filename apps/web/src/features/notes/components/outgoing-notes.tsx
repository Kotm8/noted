import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, Paperclip, RotateCw, Trash2 } from "lucide-react";
import { formatFileSize } from "../../../lib/format";
import { discard, retry, useOutbox } from "../outbox";
import { Markdown } from "./markdown";

/** Messages written without a connection, shown at the end of the channel until they send. */
export function OutgoingNotes({
  channelId,
  threadRootId,
}: {
  channelId: string;
  threadRootId?: string;
}) {
  const waiting = useOutbox(channelId, threadRootId);
  const client = useQueryClient();
  if (!waiting.length) return null;
  return (
    <div className="outgoing-notes">
      {waiting.map((item) => (
        <article
          key={item.clientId}
          className={`note outgoing-note${item.error ? " outgoing-failed" : ""}`}
          aria-label={
            item.error
              ? "Message that couldn't send"
              : "Message waiting to send"
          }
        >
          <span className="note-time" aria-hidden="true">
            <CloudOff size={13} />
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
              {item.error ? `Couldn't send: ${item.error}` : "Waiting to send"}
              {item.error && (
                <button
                  type="button"
                  onClick={() => retry(client, item.clientId)}
                >
                  <RotateCw size={12} />
                  Retry
                </button>
              )}
              <button type="button" onClick={() => discard(item.clientId)}>
                <Trash2 size={12} />
                Discard
              </button>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}
