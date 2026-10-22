import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "../../lib/http";

export interface PlanPrompt {
  id: string;
  plan_id: string;
  occurrence_date: string;
  activity_id: string;
  title: string;
  planned_start: string;
  planned_end?: string | null;
  phase?: "start" | "end";
  notify_at: string;
  revision: number;
  status: string;
}

export interface PlanPromptAction {
  action: "start" | "stop" | "delay" | "other";
  minutes?: number;
  reason?: string;
  activity_id?: string;
}

export function usePlanPrompts() {
  return useQuery({
    queryKey: ["plan-prompts"],
    queryFn: () => request<PlanPrompt[]>("/schedule/prompts"),
    refetchInterval: 5000,
    refetchOnWindowFocus: "always",
  });
}

export function usePromptAction(prompt: PlanPrompt) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: PlanPromptAction) =>
      request(`/schedule/prompts/${prompt.id}/actions`, "POST", {
        ...values,
        revision: prompt.revision,
        request_id: crypto.randomUUID(),
        requested_at: new Date().toISOString(),
      }),
    onSuccess: (_data, values) => {
      toast.success(
        values.action === "stop"
          ? "Tracking stopped"
          : values.action === "start"
            ? "Activity started"
            : values.action === "other"
              ? "Activity switched; planned task delayed"
              : "Task prompt delayed",
      );
      void client.invalidateQueries({
        queryKey: ["plan-prompt-history", prompt.plan_id],
      });
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["plan-prompts"] });
      void client.invalidateQueries({ queryKey: ["time-tracker"] });
      void client.invalidateQueries({ queryKey: ["schedule"] });
    },
  });
}
