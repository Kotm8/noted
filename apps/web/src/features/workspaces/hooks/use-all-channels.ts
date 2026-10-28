import { useQuery } from "@tanstack/react-query";
import { channelApi } from "../api";

/** Keyed under the ["channels"] prefix so every existing channel invalidation also refreshes it. */
export function useAllChannels() {
  return useQuery({
    queryKey: ["channels", "all"],
    queryFn: channelApi.listAll,
  }).data;
}
