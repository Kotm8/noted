import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { searchNotes } from "../api";
import type { SearchFilters } from "../types";

export function useNoteSearch(query: string, filters: SearchFilters) {
  const [debounced, setDebounced] = useState(query.trim());

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const search = useInfiniteQuery({
    queryKey: ["search", debounced, filters.workspaceId, filters.channelId, filters.sort],
    queryFn: ({ pageParam }) => searchNotes(debounced, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
    enabled: debounced.length >= 2,
  });

  return {
    search,
    query: debounced,
    isDebouncing: debounced !== query.trim(),
    results: search.data?.pages.flatMap((page) => page.items) ?? [],
    total: search.data?.pages[0].total ?? 0,
  };
}
