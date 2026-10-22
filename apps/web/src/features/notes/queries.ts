import { infiniteQueryOptions } from "@tanstack/react-query";
import { notesApi } from "./api";
import type { NoteCursor } from "./types";

export function notesQuery(channelId: string, targetId?: string) {
  return infiniteQueryOptions({
    queryKey: ["notes", channelId, targetId ?? "latest"],
    queryFn: ({ pageParam }) => notesApi.list(channelId, pageParam),
    initialPageParam: (targetId ? { around: targetId } : {}) as NoteCursor,
    refetchInterval: 15000,
    getNextPageParam: (lastPage): NoteCursor | undefined =>
      lastPage.next_cursor ? { before: lastPage.next_cursor } : undefined,
    getPreviousPageParam: (firstPage): NoteCursor | undefined =>
      firstPage.newer_cursor ? { after: firstPage.newer_cursor } : undefined,
  });
}
