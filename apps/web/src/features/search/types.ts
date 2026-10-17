export interface SearchResult {
  id: string;
  channel_id: string;
  workspace_id: string;
  channel_name: string;
  workspace_name: string;
  excerpt: string;
  created_at: string;
}

export interface SearchPage {
  items: SearchResult[];
  total: number;
  offset: number;
}

export interface SearchFilters {
  workspaceId: string;
  channelId: string;
  sort: "newest" | "oldest";
}
