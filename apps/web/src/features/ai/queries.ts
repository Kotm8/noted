import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { aiApi, type AiPreferences } from "./api";

export function useAiStatus() {
  return useQuery({
    queryKey: ["ai-status"],
    queryFn: aiApi.status,
    staleTime: 30000,
  });
}

export function useAiPreferences() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["ai-preferences"],
    queryFn: aiApi.preferences,
  });
  const save = useMutation({
    scope: { id: "ai-preferences" },
    mutationFn: aiApi.savePreferences,
    onMutate: (value) => {
      const previous = client.getQueryData<AiPreferences>(["ai-preferences"]);
      client.setQueryData(["ai-preferences"], value);
      return { previous };
    },
    onError: (error, _value, context) => {
      if (context?.previous)
        client.setQueryData(["ai-preferences"], context.previous);
      toast.error(error.message);
    },
  });
  return { query, save };
}

export function useAiPrompts(enabled = true) {
  return useQuery({
    queryKey: ["ai-prompts"],
    queryFn: aiApi.prompts,
    enabled,
  });
}

export function useAiModels(enabled: boolean) {
  return useQuery({
    queryKey: ["ai-models"],
    queryFn: aiApi.models,
    enabled,
    staleTime: 10 * 60000,
    retry: false,
  });
}
