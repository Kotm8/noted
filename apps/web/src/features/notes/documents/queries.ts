import { queryOptions } from "@tanstack/react-query";
import type { Channel } from "../../workspaces/types";
import { documentApi } from "./api";

export function documentQuery(channel: Channel) {
  return queryOptions({
    queryKey: ["channel-document", channel.id],
    queryFn: () => documentApi(channel.name).get(channel.id),
    refetchInterval: 15000,
  });
}
