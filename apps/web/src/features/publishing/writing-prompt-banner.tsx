import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine, X } from "lucide-react";
import { toast } from "sonner";
import { publishingApi } from "./api";

export function WritingPromptBanner({ channelId }: { channelId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["publishing", "writing", channelId],
    queryFn: () => publishingApi.writing(channelId),
    refetchInterval: 10000,
  });
  const dismiss = useMutation({
    mutationFn: () => publishingApi.dismiss(channelId, query.data!.revision),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ["publishing"] }),
        client.invalidateQueries({ queryKey: ["home-activity"] }),
      ]),
    onError: (error) => toast.error(error.message),
  });
  if (!query.data?.enabled || !query.data.due_at) return null;
  return (
    <div className="writing-prompt-banner" role="status">
      <PenLine size={16} />
      <span>
        <strong>{query.data.content}</strong>
        <small>Write here to complete this prompt.</small>
      </span>
      <button
        className="icon-button"
        aria-label="Dismiss writing prompt"
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate()}
      >
        <X size={15} />
      </button>
    </div>
  );
}
