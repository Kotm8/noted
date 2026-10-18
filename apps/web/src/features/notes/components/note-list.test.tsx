import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { AppearanceContext } from "../../settings/appearance-context";
import {
  defaultAppearance,
  type MessageLayout,
} from "../../settings/appearance";
import type { Note } from "../types";
import { NoteList } from "./note-list";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

function renderNotes(layout: MessageLayout = "minute", minutes = 2) {
  const notes: Note[] = ["13:36:50", "13:37:05", "13:40:00"].map(
    (time, index) => ({
      id: String(index),
      channel_id: "channel",
      author_id: "owner",
      content:
        index === 0 ? "**calendar**\n\nA second line" : `Thought ${index}`,
      created_at: `2026-10-16T${time}Z`,
      updated_at: `2026-10-16T${time}Z`,
      attachments: [],
    }),
  );
  return render(
    <AppearanceContext.Provider
      value={{
        preferences: {
          ...defaultAppearance,
          messageLayout: layout,
          messageGroupMinutes: minutes,
        },
        update: vi.fn(),
        reset: vi.fn(),
        isSaving: false,
        saveError: null,
      }}
    >
      <NoteList
        channelName="ideas"
        notes={notes}
        editingId={null}
        onEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </AppearanceContext.Provider>,
  );
}

describe("NoteList", () => {
  it("keeps adjacent minutes together and labels only real pauses", () => {
    const { container } = renderNotes();
    expect(container.querySelectorAll(".note-group-start")).toHaveLength(2);
    expect(container.querySelectorAll(".note-minute-marker")).toHaveLength(2);
    expect(container.querySelector("#note-1")?.parentElement).toHaveClass(
      "note-group-follow",
    );
    expect(
      container
        .querySelector("#note-1")
        ?.parentElement?.querySelector(".note-minute-marker"),
    ).toBeNull();
  });

  it.each<MessageLayout>(["minute", "connected", "quiet", "rows"])(
    "uses the account grouping interval for the %s layout",
    (layout) => {
      const { container } = renderNotes(layout, 5);
      expect(container.querySelectorAll(".note-group-start")).toHaveLength(1);
      expect(container.querySelectorAll(".note-group-follow")).toHaveLength(2);
    },
  );

  it("copies the complete note text using the button immediately after Edit", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderNotes();
    const edit = screen.getAllByRole("button", { name: "Edit note" })[0];
    const copy = screen.getAllByRole("button", { name: "Copy note" })[0];
    expect(edit.nextElementSibling).toBe(copy);
    fireEvent.click(copy);
    await waitFor(() => expect(copy).toHaveAccessibleName("Note copied"));
    expect(writeText).toHaveBeenCalledWith("**calendar**\n\nA second line");
  });

  it("keeps Copy available and shows an error when clipboard access fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderNotes();
    const copy = screen.getAllByRole("button", { name: "Copy note" })[0];
    fireEvent.click(copy);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(copy).toHaveAccessibleName("Copy note");
    writeText.mockResolvedValue(undefined);
    fireEvent.click(copy);
    await waitFor(() => expect(copy).toHaveAccessibleName("Note copied"));
  });
});
