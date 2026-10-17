import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { Notice } from "../../../components/ui/notice";
import { channelApi } from "../../workspaces/api";
import type { Workspace } from "../../workspaces/types";
import type { SearchFilters } from "../types";

interface SearchControlsProps {
  filters: SearchFilters;
  workspaces: Workspace[];
  onChange: (filters: SearchFilters) => void;
}

export function SearchControls({ filters, workspaces, onChange }: SearchControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const active = Boolean(filters.workspaceId || filters.channelId);
  const channels = useQuery({
    queryKey: ["channels", filters.workspaceId],
    queryFn: () => channelApi.list(filters.workspaceId),
    enabled: Boolean(filters.workspaceId),
  });

  return (
    <div className="search-controls">
      <div className="search-toolbar">
        <button
          className="search-tool"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={14} />
          Filters{active && <span className="search-filter-dot" aria-label="Active filters" />}
          <ChevronDown size={12} className={expanded ? "chevron-expanded" : ""} />
        </button>
        <Menu
          trigger={
            <button className="search-tool" aria-label="Sort search results">
              <ArrowDownWideNarrow size={14} />
              {filters.sort === "newest" ? "Newest" : "Oldest"}
              <ChevronDown size={12} />
            </button>
          }
        >
          <MenuItem onSelect={() => onChange({ ...filters, sort: "newest" })}>
            Newest first{filters.sort === "newest" && " ✓"}
          </MenuItem>
          <MenuItem onSelect={() => onChange({ ...filters, sort: "oldest" })}>
            Oldest first{filters.sort === "oldest" && " ✓"}
          </MenuItem>
        </Menu>
      </div>
      {expanded && (
        <div className="search-filters" id={id}>
          <label>
            Workspace
            <select
              aria-label="Workspace"
              value={filters.workspaceId}
              onChange={(event) =>
                onChange({ ...filters, workspaceId: event.target.value, channelId: "" })
              }
            >
              <option value="">All workspaces</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Channel
            <select
              aria-label="Channel"
              value={filters.channelId}
              disabled={!filters.workspaceId}
              onChange={(event) => onChange({ ...filters, channelId: event.target.value })}
            >
              <option value="">All channels</option>
              {channels.data?.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  # {channel.name}
                </option>
              ))}
            </select>
          </label>
          {active && (
            <button
              className="search-clear-filters"
              onClick={() => onChange({ ...filters, workspaceId: "", channelId: "" })}
            >
              Clear filters
            </button>
          )}
          {channels.isError && <Notice tone="error">{channels.error.message}</Notice>}
        </div>
      )}
    </div>
  );
}
