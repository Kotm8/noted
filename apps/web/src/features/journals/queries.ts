import { infiniteQueryOptions } from "@tanstack/react-query";
import { journalsApi } from "./api";

export function journalsQuery(channelId: string) {
  return infiniteQueryOptions({
    queryKey: ["journals", channelId],
    queryFn: ({ pageParam }) => journalsApi.list(channelId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, offset) =>
      lastPage.length === 50 ? offset + 50 : undefined,
    refetchInterval: 15000,
  });
}
