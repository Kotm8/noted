import { useQuery } from "@tanstack/react-query";
import { hostApi } from "./api";

export const hostKey = ["host-status"];

export function useHost() {
  return useQuery({
    queryKey: hostKey,
    queryFn: hostApi.status,
    retry: false,
    refetchInterval: (query) =>
      ["queued", "running", "waiting_dns"].includes(
        query.state.data?.job?.status ?? "",
      )
        ? 2000
        : 30_000,
  });
}
