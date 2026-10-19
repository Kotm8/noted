import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { request } from "../../lib/http";
import type { HomeActivity, HomeActivityPage } from "./types";

export function useHomeActivity(limit: number) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["home-activity", limit],
    queryFn: () => request<HomeActivityPage>(`/home/activity?limit=${limit}`),
    refetchInterval: 15000,
    refetchOnWindowFocus: "always",
  });
  const read = useMutation({
    mutationFn: (items: HomeActivity[]) =>
      request<void>("/home/activity/read", "POST", {
        items: items.map(({ kind, id, revision }) => ({ kind, id, revision })),
      }),
    onError: (error) => toast.error(error.message),
    onSettled: () => client.invalidateQueries({ queryKey: ["home-activity"] }),
  });
  return { query, read };
}
