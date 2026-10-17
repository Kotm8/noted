import { useQuery } from "@tanstack/react-query";
import { updatesApi } from "./api";

export const serverUpdatesKey = ["server-updates"];

export function useServerUpdates() {
  return useQuery({
    queryKey: serverUpdatesKey,
    queryFn: updatesApi.status,
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy = data?.job?.status === "queued" || data?.job?.status === "running";
      return busy || data?.download_status === "downloading" ? 2000 : 60_000;
    },
    retry: false,
  });
}
