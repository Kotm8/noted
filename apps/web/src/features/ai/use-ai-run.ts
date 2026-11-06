import { useEffect, useRef, useState } from "react";
import {
  aiApi,
  runAi,
  type AiChange,
  type AiEvent,
  type AiKind,
  type AiRunInput,
  type AiSource,
} from "./api";
import type { CalendarProposal, CalendarRequest } from "./calendar/types";

export type AiStage =
  | "asking"
  | "thinking"
  | "searching"
  | "writing"
  | "done"
  | "applied"
  | "error";
export interface AiResult {
  id: string | null;
  name: string;
  kind: AiKind;
  model: string;
  stage: AiStage;
  text: string;
  changes: AiChange[];
  heading: string;
  query: string;
  searchScope?: "web" | "noted";
  contextActivity?: string;
  notedSearched?: boolean;
  searched: boolean;
  sources: AiSource[];
  thoughtSeconds: number | null;
  error: string | null;
  code: string | null;
  proposal: CalendarProposal | null;
}

export function newAiResult(
  kind: AiKind = "answer",
  name = "Custom prompt",
): AiResult {
  return {
    id: null,
    name,
    kind,
    model: "",
    stage: "asking",
    text: "",
    changes: [],
    heading: "",
    query: "",
    searched: false,
    sources: [],
    thoughtSeconds: null,
    error: null,
    code: null,
    proposal: null,
  };
}

export function aiTransition(
  current: AiResult,
  event: AiEvent,
  elapsed: number,
): AiResult {
  switch (event.type) {
    case "start":
      return {
        ...current,
        id: event.run_id,
        name: event.prompt_name,
        kind: event.kind,
        model: event.model,
        stage: "thinking",
      };
    case "thinking":
      return { ...current, stage: "thinking", heading: event.heading || "" };
    case "search":
      return {
        ...current,
        stage: "searching",
        searched: event.scope === "noted" ? current.searched : true,
        notedSearched: current.notedSearched || event.scope === "noted",
        searchScope: event.scope ?? "web",
        contextActivity:
          event.action === "read"
            ? "Reading a note"
            : event.action === "image"
              ? "Viewing a picture"
              : "Searching Noted",
        query: event.query,
      };
    case "sources":
      return { ...current, sources: event.sources };
    case "text":
      return {
        ...current,
        stage: "writing",
        text: event.text,
        thoughtSeconds:
          current.thoughtSeconds ?? event.thought_seconds ?? elapsed,
      };
    case "changes":
      return {
        ...current,
        stage: "writing",
        changes: event.changes,
        thoughtSeconds:
          current.thoughtSeconds ?? event.thought_seconds ?? elapsed,
      };
    case "done":
      return {
        ...current,
        stage: "done",
        text: typeof event.output === "string" ? event.output : current.text,
        changes: Array.isArray(event.output) ? event.output : current.changes,
        proposal:
          typeof event.output === "object" && !Array.isArray(event.output)
            ? event.output
            : current.proposal,
        sources: event.sources ?? current.sources,
        searched: event.searched ?? current.searched,
        thoughtSeconds:
          event.thought_seconds ?? current.thoughtSeconds ?? elapsed,
      };
    case "error":
      return {
        ...current,
        stage: "error",
        code: event.code,
        error: event.message,
      };
    case "explanation":
    case "chat":
    case "turn":
    case "memory":
      return current;
  }
}

export function useAiRun() {
  const [result, setResult] = useState<AiResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(result);
  latest.current = result;
  const cancel = (clear = true) => {
    controller.current?.abort();
    controller.current = null;
    if (
      latest.current?.id &&
      !["applied", "done", "error"].includes(latest.current.stage)
    )
      void aiApi
        .setOutcome(latest.current.id, "cancelled")
        .catch(() => undefined);
    if (clear) setResult(null);
    else setResult((current) => current && { ...current, stage: "done" });
  };
  useEffect(
    () => () => {
      controller.current?.abort();
      if (
        latest.current?.id &&
        !["done", "applied", "error"].includes(latest.current.stage)
      )
        void aiApi
          .setOutcome(latest.current.id, "cancelled")
          .catch(() => undefined);
    },
    [],
  );
  async function start(
    input: AiRunInput | CalendarRequest,
    name?: string,
    path?: string,
  ): Promise<AiResult | null> {
    cancel();
    const abort = new AbortController();
    controller.current = abort;
    let next = newAiResult("kind" in input ? input.kind : "answer", name);
    setResult(next);
    const started = performance.now();
    try {
      await runAi(
        input,
        (event) => {
          if (controller.current !== abort) return;
          next = aiTransition(
            next,
            event,
            (performance.now() - started) / 1000,
          );
          latest.current = next;
          setResult(next);
        },
        abort.signal,
        path,
      );
      if (abort.signal.aborted) return null;
      if (!["done", "error"].includes(next.stage))
        throw new Error("The answer stopped before it finished. Try again.");
    } catch (error) {
      if (abort.signal.aborted) return null;
      next = {
        ...next,
        stage: "error",
        error: error instanceof Error ? error.message : "Could not reach AI.",
      };
      setResult(next);
    }
    return next;
  }
  function applied() {
    if (latest.current?.id)
      void aiApi
        .setOutcome(latest.current.id, "applied")
        .catch(() => undefined);
    setResult((current) => current && { ...current, stage: "applied" });
  }
  return {
    result,
    start,
    cancel,
    applied,
    busy: Boolean(
      result && !["done", "applied", "error"].includes(result.stage),
    ),
  };
}
