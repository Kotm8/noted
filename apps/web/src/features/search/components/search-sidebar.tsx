import { Notice } from "../../../components/ui/notice";
import { useEffect, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { Workspace } from "../../workspaces/types";
import { useNoteSearch } from "../hooks/use-note-search";
import type { SearchFilters, SearchResult as Result } from "../types";
import { SearchResult } from "./search-result";
import { SearchControls } from "./search-controls";

interface SearchSidebarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  workspaces: Workspace[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onSelect: (result: Result) => void;
}

export function SearchSidebar({
  inputRef,
  query,
  workspaces,
  onQueryChange,
  onClose,
  onSelect,
}: SearchSidebarProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    workspaceId: "",
    channelId: "",
    sort: "newest",
  });
  const { search, results, total, query: searchTerm, isDebouncing } = useNoteSearch(query, filters);
  const hasQuery = query.trim().length >= 2;

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return (
    <aside className="search-sidebar" aria-label="Search results">
      <div className="search-sidebar-title">
        <h2>Search</h2>
        <button className="icon-button" aria-label="Close search" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="search-input">
        <Search size={16} />
        <input
          ref={inputRef}
          aria-label="Search notes"
          placeholder="Search notes"
          value={query}
          maxLength={200}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <SearchControls filters={filters} workspaces={workspaces} onChange={setFilters} />
      <div className="search-results-list">
        {!hasQuery ? (
          <div className="search-empty">
            <Search size={25} />
            <h3>Search your notes</h3>
            <p>
              Enter at least two characters. Search all workspaces or narrow the results with
              filters.
            </p>
          </div>
        ) : isDebouncing || search.isPending ? (
          <p className="search-status" role="status">
            Searching...
          </p>
        ) : search.isError ? (
          <div className="search-status">
            <Notice tone="error">{search.error.message}</Notice>
            <Button variant="secondary" onClick={() => void search.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            <p className="search-count" role="status">
              {total} {total === 1 ? "result" : "results"}
            </p>
            {results.map((result) => (
              <SearchResult
                key={result.id}
                result={result}
                query={searchTerm}
                onSelect={onSelect}
              />
            ))}
            {!results.length && (
              <div className="search-empty">
                <h3>No results</h3>
                <p>Try another phrase or change the workspace and channel filters.</p>
              </div>
            )}
            {search.hasNextPage && (
              <div className="search-load-more">
                <Button
                  size="small"
                  variant="secondary"
                  disabled={search.isFetchingNextPage}
                  onClick={() => void search.fetchNextPage()}
                >
                  {search.isFetchingNextPage ? "Loading..." : "More results"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
