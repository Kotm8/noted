import { BookOpen, FileText, Hash, MessageSquare } from "lucide-react";
import type { SearchResult as Result } from "../types";

function HighlightedExcerpt({ text, query }: { text: string; query: string }) {
  const position = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (position < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, position)}
      <mark>{text.slice(position, position + query.length)}</mark>
      {text.slice(position + query.length)}
    </>
  );
}

export function SearchResult({
  result,
  query,
  onSelect,
}: {
  result: Result;
  query: string;
  onSelect: (result: Result) => void;
}) {
  return (
    <button className="search-result" onClick={() => onSelect(result)}>
      <span className="search-result-channel">
        {result.kind === "document" ? (
          <FileText size={14} />
        ) : result.kind === "journal" ? (
          <BookOpen size={14} />
        ) : result.thread_root_id ? (
          <MessageSquare size={14} />
        ) : (
          <Hash size={14} />
        )}
        <strong>{result.channel_name}</strong>
        <span>{result.workspace_name}</span>
      </span>
      <time dateTime={result.created_at}>
        {new Date(result.created_at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <span className="search-result-excerpt">
        <HighlightedExcerpt text={result.excerpt} query={query} />
      </span>
    </button>
  );
}
