import { afterEach, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { aiTransition, newAiResult, useAiRun } from "./use-ai-run";

afterEach(() => vi.unstubAllGlobals());

it("distinguishes searching Noted from searching the web", () => {
  let state = aiTransition(
    newAiResult(),
    { type: "search", query: "Tuesday", scope: "noted", action: "search" },
    1,
  );
  expect(state.searchScope).toBe("noted");
  expect(state.contextActivity).toBe("Searching Noted");
  expect(state.notedSearched).toBe(true);
  expect(state.searched).toBe(false);
  state = aiTransition(
    state,
    { type: "search", query: "entry-id", scope: "noted", action: "read" },
    2,
  );
  expect(state.contextActivity).toBe("Reading a note");
  state = aiTransition(
    state,
    { type: "text", text: "Based on your journal" },
    3,
  );
  expect(state.notedSearched).toBe(true);
});

it("tracks thinking, searching, text, sources and completion", () => {
  let state = newAiResult();
  state = aiTransition(
    state,
    {
      type: "start",
      run_id: "run",
      kind: "answer",
      prompt_name: "Summary",
      model: "gpt-6.1-sol",
    },
    0,
  );
  state = aiTransition(
    state,
    { type: "thinking", heading: "Checking plans" },
    1,
  );
  expect(state.stage).toBe("thinking");
  expect(state.heading).toBe("Checking plans");
  state = aiTransition(state, { type: "search", query: "Train times" }, 2);
  expect(state.stage).toBe("searching");
  state = aiTransition(state, { type: "text", text: "Answer" }, 3);
  state = aiTransition(state, { type: "text", text: "Answer continued" }, 5);
  expect(state.thoughtSeconds).toBe(3);
  state = aiTransition(
    state,
    {
      type: "sources",
      sources: [{ url: "https://example.com", title: "Times" }],
    },
    5,
  );
  state = aiTransition(state, { type: "done", output: "Answer continued" }, 6);
  expect(state.stage).toBe("done");
  expect(state.searched).toBe(true);
  expect(state.sources).toHaveLength(1);
});

it("preserves partial output when a stream errors", () => {
  const state = aiTransition(
    { ...newAiResult(), text: "Partial" },
    { type: "error", code: "limit", message: "Limit reached" },
    3,
  );
  expect(state).toMatchObject({
    stage: "error",
    text: "Partial",
    code: "limit",
  });
});

it("does not treat an unfinished connection as a complete answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response('{"type":"text","text":"Partial"}\n')),
  );
  const hook = renderHook(() => useAiRun());
  await act(async () => {
    await hook.result.current.start({
      place: "documents",
      instructions: "Help",
      kind: "answer",
    });
  });
  expect(hook.result.current.result?.stage).toBe("error");
  expect(hook.result.current.result?.text).toBe("Partial");
});
