import { describe, expect, it } from "vitest";
import {
  codeBlock,
  insertDivider,
  insertLink,
  setLineFormat,
  toggleInline,
  type Formatted,
} from "./markdown-format";

function apply(value: string, { edit, selection }: Formatted) {
  const text = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return { text, selected: text.slice(...selection) };
}

describe("toggleInline", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(
      apply("make it bold", toggleInline("make it bold", 8, 12, "bold")),
    ).toEqual({
      text: "make it **bold**",
      selected: "bold",
    });
  });

  it("inserts a placeholder with nothing selected", () => {
    expect(apply("", toggleInline("", 0, 0, "strike"))).toEqual({
      text: "~~struck text~~",
      selected: "struck text",
    });
  });

  it("unwraps text that is already wrapped", () => {
    const value = "make it **bold**";
    expect(apply(value, toggleInline(value, 10, 14, "bold")).text).toBe(
      "make it bold",
    );
    expect(apply(value, toggleInline(value, 8, 16, "bold")).text).toBe(
      "make it bold",
    );
  });
});

describe("setLineFormat", () => {
  it("turns every selected line into a list and numbers them", () => {
    const value = "one\ntwo\nthree";
    expect(
      apply(value, setLineFormat(value, 0, value.length, "numbered")).text,
    ).toBe("1. one\n2. two\n3. three");
  });

  it("switches one block type for another", () => {
    expect(apply("- item", setLineFormat("- item", 3, 3, "task")).text).toBe(
      "- [ ] item",
    );
    expect(apply("> said", setLineFormat("> said", 2, 2, "h2")).text).toBe(
      "## said",
    );
  });

  it("goes back to plain text when the lines already have that type", () => {
    const value = "- a\n- b";
    expect(
      apply(value, setLineFormat(value, 0, value.length, "bullet")).text,
    ).toBe("a\nb");
    expect(
      apply("# Title", setLineFormat("# Title", 3, 3, "normal")).text,
    ).toBe("Title");
  });

  it("keeps indentation and leaves blank lines alone", () => {
    const value = "  nested\n\nnext";
    expect(
      apply(value, setLineFormat(value, 0, value.length, "quote")).text,
    ).toBe("  > nested\n\n> next");
  });
});

describe("blocks and links", () => {
  it("puts a code block on its own lines", () => {
    expect(apply("see x here", codeBlock("see x here", 4, 5))).toEqual({
      text: "see \n```\nx\n```\n here",
      selected: "x",
    });
  });

  it("adds a blank line before a divider so the text above stays text", () => {
    expect(apply("above", insertDivider("above", 5, 5)).text).toBe(
      "above\n\n---\n",
    );
    expect(apply("", insertDivider("", 0, 0)).text).toBe("---\n");
  });

  it("writes a Markdown link, falling back to the address as text", () => {
    expect(
      apply("", insertLink("", 0, 0, "Noted", "https://example.com")).text,
    ).toBe("[Noted](https://example.com)");
    expect(apply("", insertLink("", 0, 0, "", "https://a.b/c d")).text).toBe(
      "[https://a.b/c d](https://a.b/c%20d)",
    );
  });
});
