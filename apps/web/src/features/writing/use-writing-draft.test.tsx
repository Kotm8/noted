import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWritingDraft } from "./use-writing-draft";

const entry = {
  id: "entry",
  channel_id: "channel",
  title: "Entry",
  content: "Original",
  revision: 1,
};
const queryKey = ["journal-entry", entry.id];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

function editor(
  update: (
    id: string,
    draft: { title: string; content: string; revision: number },
  ) => Promise<typeof entry>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKey, entry);
  const options = {
    storageKey: "live-draft-test",
    queryKey,
    update,
    get: async () => entry,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook((record) => useWritingDraft(record, options), {
      initialProps: entry,
      wrapper,
    }),
  };
}

it("does not mistake its own live update for a conflict while autosaving", async () => {
  let resolve!: (value: typeof entry) => void;
  const response = new Promise<typeof entry>((done) => {
    resolve = done;
  });
  const { result, rerender, unmount } = editor(() => response);
  act(() => result.current.setDraft({ content: "My writing" }));
  let save!: Promise<void>;
  act(() => {
    save = result.current.flush();
  });
  rerender({ ...entry, content: "My writing", revision: 2 });
  expect(result.current.error).toBeNull();
  await act(async () => {
    resolve({ ...entry, content: "My writing", revision: 2 });
    await save;
  });
  expect(result.current.error).toBeNull();
  expect(result.current.draft.content).toBe("My writing");
  unmount();
});

it("preserves dirty writing when a newer remote version arrives", () => {
  const { result, rerender, unmount } = editor(async () => entry);
  act(() => result.current.setDraft({ content: "Unsaved writing" }));
  rerender({ ...entry, content: "Another device", revision: 2 });
  expect(result.current.draft.content).toBe("Unsaved writing");
  expect(result.current.error?.message).toContain("Your draft has been kept");
  unmount();
});

it("a late autosave response cannot replace a newer version in the query cache", async () => {
  let resolve!: (value: typeof entry) => void;
  const response = new Promise<typeof entry>((done) => {
    resolve = done;
  });
  const { result, client, rerender, unmount } = editor(() => response);
  act(() => result.current.setDraft({ content: "My writing" }));
  let save!: Promise<void>;
  act(() => {
    save = result.current.flush();
  });
  const remote = { ...entry, content: "A later remote edit", revision: 3 };
  client.setQueryData(queryKey, remote);
  rerender(remote);
  await act(async () => {
    resolve({ ...entry, content: "My writing", revision: 2 });
    await save;
  });
  expect(client.getQueryData(queryKey)).toEqual(remote);
  expect(result.current.draft.content).toBe("A later remote edit");
  expect(result.current.error).toBeNull();
  unmount();
});
