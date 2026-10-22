import { infiniteQueryOptions } from "@tanstack/react-query";
import { threadsApi } from "./api";
import type { NoteCursor } from "../notes/types";

export function threadQuery(rootId: string, targetId?: string) {
  return infiniteQueryOptions({
    queryKey: ["thread", rootId, targetId ?? "latest"],
    queryFn: ({ pageParam }) => threadsApi.read(rootId, pageParam),
    initialPageParam: (targetId ? { around: targetId } : {}) as NoteCursor,
    getNextPageParam: (page): NoteCursor | undefined =>
      page.replies.next_cursor
        ? { before: page.replies.next_cursor }
        : undefined,
    getPreviousPageParam: (page): NoteCursor | undefined =>
      page.replies.newer_cursor
        ? { after: page.replies.newer_cursor }
        : undefined,
    refetchInterval: 15000,
  });
}
