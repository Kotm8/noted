import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine, X } from "lucide-react";
import { toast } from "sonner";
import { request } from "../../lib/http";
import { useLiveInterval } from "../../lib/use-live-updates";
import type { WritingNudge } from "./types";

export function NudgeBanner({ channelId }: { channelId: string }) {
  const client = useQueryClient();
  const interval = useLiveInterval(10000);
  const query = useQuery({
    queryKey: ["publishing", "nudges", channelId],
    queryFn: () =>
      request<WritingNudge[]>(
        `/time-tracking/writing-nudges?channel_id=${channelId}`,
      ),
    refetchInterval: interval,
  });
  const dismiss = useMutation({
    mutationFn: (item: WritingNudge) =>
      request<void>(
        `/time-tracking/writing-nudges/${item.id}/dismiss`,
        "POST",
        { revision: item.revision },
      ),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["publishing"] }),
        client.invalidateQueries({ queryKey: ["home-activity"] }),
      ]),
    onError: (error) => toast.error(error.message),
  });
  return (
    query.data?.map((item) => (
      <div className="writing-prompt-banner" role="status" key={item.id}>
        <PenLine size={16} />
        <span>
          <strong>{item.content}</strong>
          <small>Write here to restart your nudge countdown.</small>
        </span>
        <button
          className="icon-button"
          aria-label="Dismiss writing nudge"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(item)}
        >
          <X size={15} />
        </button>
      </div>
    )) ?? null
  );
}
