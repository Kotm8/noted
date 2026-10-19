import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../../lib/http";
import { Notice } from "../../../components/ui/notice";

interface Event {
  id: string;
  created_at: string;
  action: string;
  minutes: number | null;
  reason: string | null;
}

export function PromptHistory({ planId }: { planId: string }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ["plan-prompt-history", planId],
    queryFn: () => request<Event[]>(`/schedule/plans/${planId}/prompt-history`),
    enabled: open,
  });
  return (
    <details
      className="plan-prompt-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Activity prompt history</summary>
      {history.isError && <Notice tone="error">{history.error.message}</Notice>}
      {history.isPending && <p>Loading history...</p>}
      {history.data?.length === 0 && <p>No activity prompt actions yet.</p>}
      {history.data?.map((event) => (
        <div key={event.id}>
          <time>{new Date(event.created_at).toLocaleString()}</time>
          <strong>
            {event.action === "start"
              ? "Started activity"
              : event.action === "other"
                ? `Switched activity; delayed ${event.minutes} min`
                : `Delayed ${event.minutes} min`}
          </strong>
          {event.reason && <p>{event.reason}</p>}
        </div>
      ))}
    </details>
  );
}
