import { describe, expect, it } from "vitest";
import {
  insertParagraph,
  markdownText,
  matchSelection,
  paragraphEnd,
} from "./selection";

describe("Markdown selections", () => {
  it.each([
    ["Before **bold words** after", "bold words after", "**bold words** after"],
    [
      "Read [train times](https://example.com) today",
      "train times",
      "[train times](https://example.com)",
    ],
    ["- First\n- Second", "First Second", "First\n- Second"],
    [
      "- [ ] Book train\n- [x] Pack bag",
      "Book train Pack bag",
      "Book train\n- [x] Pack bag",
    ],
    [
      "First paragraph.\n\nSecond paragraph.",
      "paragraph.\n\nSecond",
      "paragraph.\n\nSecond",
    ],
    [
      "# Heading\n\n> A *quiet* morning",
      "A quiet morning",
      "A *quiet* morning",
    ],
    [
      "Use `some code` and ~~old text~~",
      "some code and old text",
      "`some code` and ~~old text~~",
    ],
  ])("maps %s back to safe source boundaries", (source, selected, expected) => {
    const range = matchSelection(source, selected);
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe(expected);
  });
  it("chooses the repeated occurrence nearest the selected DOM position", () => {
    const source = "Same thought.\n\nOther words.\n\nSame thought.";
    const near = markdownText(source).text.lastIndexOf("Same");
    expect(matchSelection(source, "Same thought.", near)?.start).toBe(
      source.lastIndexOf("Same"),
    );
  });
  it("falls back when rendered text cannot be mapped", () => {
    expect(
      matchSelection("<table>Special HTML</table>", "Unrelated"),
    ).toBeNull();
    expect(matchSelection("hello", "   ")).toBeNull();
  });
});

describe("Document insertion", () => {
  it("snaps inside a paragraph to its end", () => {
    expect(paragraphEnd("First line\nstill first.\n\nNext.", 4)).toBe(23);
  });
  it("uses the document end without a following boundary", () => {
    expect(paragraphEnd("Last paragraph", 2)).toBe(14);
    expect(paragraphEnd("", 0)).toBe(0);
  });
  it("inserts a distinct paragraph without joining adjacent content", () => {
    expect(insertParagraph("First.\n\nLast.", 6, "AI answer")).toBe(
      "First.\n\nAI answer\n\nLast.",
    );
    expect(insertParagraph("", 0, "AI answer")).toBe("AI answer");
  });
  it("preserves source indentation on both sides of an insertion", () => {
    expect(insertParagraph("  First.\n\n    code()", 8, "Answer")).toBe(
      "  First.\n\nAnswer\n\n    code()",
    );
  });
});
