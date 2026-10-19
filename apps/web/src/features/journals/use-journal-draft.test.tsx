import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApiError } from "../../lib/http";
import { journalsApi } from "./api";
import { useJournalDraft } from "./use-journal-draft";
import type { JournalEntry } from "./types";

const entry: JournalEntry = {
  id: "entry",
  channel_id: "channel",
  title: "Morning",
  content: "- [ ] Read",
  revision: 1,
  created_at: "2026-10-18T08:00:00Z",
  updated_at: "2026-10-18T08:00:00Z",
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Journal draft", () => {
  it("ignores an older read response that arrives after saving", async () => {
    vi.spyOn(journalsApi, "update").mockImplementation(async (_id, data) => ({
      ...entry,
      ...data,
      revision: 2,
    }));
    const { result, rerender } = renderHook(
      ({ remote }) => useJournalDraft(remote),
      { initialProps: { remote: entry }, wrapper },
    );
    act(() => result.current.setDraft({ content: "Latest content" }));
    await act(async () => result.current.flush());
    rerender({ remote: { ...entry } });
    expect(result.current.draft.content).toBe("Latest content");
    expect(result.current.draft.revision).toBe(2);
  });
  it("can save after a clean flush and persists checkbox changes", async () => {
    const update = vi
      .spyOn(journalsApi, "update")
      .mockImplementation(async (_id, data) => ({
        ...entry,
        ...data,
        revision: data.revision + 1,
      }));
    const { result } = renderHook(() => useJournalDraft(entry), { wrapper });
    await act(async () => result.current.flush());
    act(() => result.current.setDraft({ content: "- [x] Read" }));
    expect(
      JSON.parse(localStorage.getItem("noted.journal-draft.entry")!).content,
    ).toBe("- [x] Read");
    await act(async () => result.current.flush());
    expect(update).toHaveBeenCalledWith("entry", {
      title: "Morning",
      content: "- [x] Read",
      revision: 1,
    });
    expect(result.current.dirty).toBe(false);
    expect(localStorage.getItem("noted.journal-draft.entry")).toBeNull();
  });

  it("serializes edits typed while a save is pending", async () => {
    let finish!: (value: JournalEntry) => void;
    const update = vi
      .spyOn(journalsApi, "update")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(async (_id, data) => ({
        ...entry,
        ...data,
        revision: data.revision + 1,
      }));
    const { result } = renderHook(() => useJournalDraft(entry), { wrapper });
    act(() => result.current.setDraft({ content: "First edit" }));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.flush();
    });
    act(() => result.current.setDraft({ content: "Second edit" }));
    await act(async () => {
      finish({ ...entry, content: "First edit", revision: 2 });
      await saving;
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith("entry", {
      title: "Morning",
      content: "Second edit",
      revision: 2,
    });
    expect(result.current.draft.content).toBe("Second edit");
    expect(result.current.dirty).toBe(false);
  });

  it("keeps a conflicting draft and does not silently replace server content", async () => {
    const update = vi
      .spyOn(journalsApi, "update")
      .mockRejectedValue(new ApiError(409, "Entry changed"));
    const { result } = renderHook(() => useJournalDraft(entry), { wrapper });
    act(() => result.current.setDraft({ content: "Keep this draft" }));
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow("Entry changed");
    });
    expect(result.current.draft.content).toBe("Keep this draft");
    expect(result.current.error?.message).toBe("Entry changed");
    expect(
      JSON.parse(localStorage.getItem("noted.journal-draft.entry")!).content,
    ).toBe("Keep this draft");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("flushes a pending draft when navigating away before the debounce", async () => {
    const update = vi
      .spyOn(journalsApi, "update")
      .mockImplementation(async (_id, data) => ({
        ...entry,
        ...data,
        revision: 2,
      }));
    const { result, unmount } = renderHook(() => useJournalDraft(entry), {
      wrapper,
    });
    act(() => result.current.setDraft({ content: "Save on leaving" }));
    unmount();
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("entry", {
        title: "Morning",
        content: "Save on leaving",
        revision: 1,
      }),
    );
    await waitFor(() =>
      expect(localStorage.getItem("noted.journal-draft.entry")).toBeNull(),
    );
  });
});
