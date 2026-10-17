import { request } from "../../lib/http";
import type { SearchFilters, SearchPage } from "./types";

export function searchNotes(
  query: string,
  filters: SearchFilters,
  offset: number,
): Promise<SearchPage> {
  const parameters = new URLSearchParams({
    q: query,
    sort: filters.sort,
    offset: String(offset),
    limit: "20",
  });
  if (filters.workspaceId) parameters.set("workspace_id", filters.workspaceId);
  if (filters.channelId) parameters.set("channel_id", filters.channelId);
  return request<SearchPage>(`/search?${parameters}`);
}
