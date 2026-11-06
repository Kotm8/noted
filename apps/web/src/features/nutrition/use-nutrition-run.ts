import { useCallback, useEffect, useRef, useState } from "react";
import type { AiSource } from "../ai/api";
import type { MealItem, NutritionEvent } from "./types";

export type RunStage =
  | "idle"
  | "thinking"
  | "searching"
  | "writing"
  | "done"
  | "error";

export interface RunState<T> {
  stage: RunStage;
  heading: string;
  query: string;
  items: MealItem[];
  output: T | null;
  sources: AiSource[];
  thoughtSeconds: number | null;
  searched: boolean;
  error: string | null;
  code: string | null;
}

const idle = <T>(): RunState<T> => ({
  stage: "idle",
  heading: "",
  query: "",
  items: [],
  output: null,
  sources: [],
  thoughtSeconds: null,
  searched: false,
  error: null,
  code: null,
});

export function applyEvent<T>(
  state: RunState<T>,
  event: NutritionEvent,
): RunState<T> {
  switch (event.type) {
    case "start":
      return { ...idle<T>(), stage: "thinking" };
    case "thinking":
      return state.stage === "writing"
        ? state
        : {
            ...state,
            stage: "thinking",
            heading: event.heading || state.heading,
          };
    case "search":
      return {
        ...state,
        stage: "searching",
        query: event.query || state.query,
        searched: true,
      };
    case "sources":
      return { ...state, sources: event.sources };
    case "items":
      return {
        ...state,
        stage: "writing",
        items: event.items,
        thoughtSeconds: event.thought_seconds ?? state.thoughtSeconds,
      };
    case "done":
      return {
        ...state,
        stage: "done",
        output: event.output as T,
        sources: event.sources ?? state.sources,
        thoughtSeconds: event.thought_seconds ?? state.thoughtSeconds,
        searched: event.searched ?? state.searched,
      };
    case "error":
      return {
        ...state,
        stage: "error",
        error: event.message,
        code: event.code,
      };
    default:
      return state;
  }
}

/** Follows one streamed Nutrition run; starting another cancels the one before. */
export function useNutritionRun<T>() {
  const [state, setState] = useState<RunState<T>>(idle);
  const controller = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState(idle());
  }, []);
  const start = useCallback(
    async (
      run: (
        onEvent: (event: NutritionEvent) => void,
        signal: AbortSignal,
      ) => Promise<void>,
    ) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setState({ ...idle<T>(), stage: "thinking" });
      try {
        await run((event) => {
          if (!current.signal.aborted)
            setState((before) => applyEvent(before, event));
        }, current.signal);
      } catch (error) {
        if (!current.signal.aborted)
          setState((before) => ({
            ...before,
            stage: "error",
            error: (error as Error).message,
            code: "other",
          }));
      }
    },
    [],
  );
  useEffect(() => () => controller.current?.abort(), []);
  return { ...state, start, cancel };
}
