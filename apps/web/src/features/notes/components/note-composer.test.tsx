import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteComposer } from "./note-composer";

const channel = {
  id: "channel-1",
  workspace_id: "workspace-1",
  category_id: null,
  name: "ideas",
  banner_url: null,
  position: 0,
  created_at: "2026-10-15T12:00:00Z",
};

beforeEach(() => window.localStorage.clear());

describe("NoteComposer", () => {
  it("sends on Enter and clears the draft", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteComposer channel={channel} isSending={false} onSend={onSend} onEditLast={vi.fn()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "A thought worth keeping" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("A thought worth keeping", []));
    expect(input).toHaveValue("");
  });

  it("sends a message written during a send after it, in order", async () => {
    let finish = () => {};
    const onSend = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined);
    render(
      <NoteComposer channel={channel} isSending={false} onSend={onSend} onEditLast={vi.fn()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "First" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "Second" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("");
    expect(onSend).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith("Second", []));
  });

  it("preserves a failed note as a draft", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Unavailable"));
    render(
      <NoteComposer channel={channel} isSending={false} onSend={onSend} onEditLast={vi.fn()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Do not lose this" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(input).toHaveValue("Do not lose this");
    expect(window.localStorage.getItem("noted.draft.channel-1")).toBe("Do not lose this");
  });

  it("keeps Shift+Enter and IME composition from sending", () => {
    const onSend = vi.fn();
    render(
      <NoteComposer channel={channel} isSending={false} onSend={onSend} onEditLast={vi.fn()} />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "A multiline note" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("retains files after failure and allows retrying a file-only note", async () => {
    const onSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue(undefined);
    render(
      <NoteComposer channel={channel} isSending={false} onSend={onSend} onEditLast={vi.fn()} />,
    );
    const file = new File(["reference"], "reference.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Send note" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", [file]));
    expect(screen.getByRole("button", { name: "Remove reference.txt" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send note" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove reference.txt" }),
      ).not.toBeInTheDocument(),
    );
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
