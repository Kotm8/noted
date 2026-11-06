import { BookOpen, Globe, LoaderCircle, ChevronDown } from "lucide-react";
import type { AiSource } from "../api";
import type { AiResult } from "../use-ai-run";

export function AiThinking({
  result,
}: {
  result: Pick<
    AiResult,
    | "stage"
    | "heading"
    | "query"
    | "searched"
    | "thoughtSeconds"
    | "searchScope"
    | "contextActivity"
    | "notedSearched"
  >;
}) {
  if (["asking", "thinking"].includes(result.stage))
    return (
      <div className="ai-thinking" role="status">
        <LoaderCircle size={14} className="spin" />
        <span className="ai-shimmer">Thinking</span>
        {result.heading && <small>{result.heading}</small>}
      </div>
    );
  if (result.stage === "searching")
    return (
      <div className="ai-thinking" role="status">
        {result.searchScope === "noted" ? (
          <BookOpen size={14} />
        ) : (
          <Globe size={14} />
        )}
        <span>
          {result.searchScope === "noted"
            ? (result.contextActivity ?? "Searching Noted")
            : "Searching the web"}
        </span>
        {result.query &&
          (result.searchScope !== "noted" ||
            result.contextActivity === "Searching Noted") && (
            <small title={result.query}>{result.query}</small>
          )}
      </div>
    );
  if (result.thoughtSeconds === null) return null;
  return (
    <div className="ai-thought">
      Thought for {Math.max(1, Math.round(result.thoughtSeconds))}s
      {result.searched && " · searched the web"}
      {result.notedSearched && " · looked in Noted"}
    </div>
  );
}

export function AiSources({ sources }: { sources: AiSource[] }) {
  const unique = [
    ...new Map(sources.map((source) => [source.url, source])).values(),
  ].filter((source) => {
    try {
      return ["http:", "https:"].includes(
        new URL(source.url, window.location.origin).protocol,
      );
    } catch {
      return false;
    }
  });
  if (!unique.length) return null;
  return (
    <details className="ai-source-disclosure">
      <summary>
        <BookOpen size={14} />
        {unique.length} {unique.length === 1 ? "source" : "sources"}
        <ChevronDown size={14} />
      </summary>
      <div className="ai-sources" aria-label="Sources">
        {unique.map((source) => {
          const internal = /^\/w\/[0-9a-f-]{36}\/c\/[0-9a-f-]{36}(?:\?|$)/.test(
            source.url,
          );
          let host: string;
          try {
            const url = new URL(source.url, window.location.origin);
            if (!internal && !["https:", "http:"].includes(url.protocol))
              return null;
            host = internal ? source.title : url.hostname.replace(/^www\./, "");
          } catch {
            return null;
          }
          return (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.title}
            >
              <span>
                {internal ? <BookOpen size={13} /> : host[0].toUpperCase()}
              </span>
              {host}
            </a>
          );
        })}
      </div>
    </details>
  );
}
