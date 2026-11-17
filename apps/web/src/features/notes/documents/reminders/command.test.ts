import { describe, expect, it } from "vitest";
import { documentReminderCommand } from "./command";

describe("document reminder commands", () => {
  it("recognizes the command line at the caret without consuming other lines", () => {
    const text = "My notes\n/remind Call the dentist\nKeep this";
    const caret = text.indexOf("\nKeep");
    expect(documentReminderCommand(text, caret, caret)).toMatchObject({
      content: "Call the dentist",
      delay: 60,
      start: 9,
      end: caret,
    });
    expect(documentReminderCommand(text, caret - 2, caret - 2)).toBeNull();
    expect(documentReminderCommand(text, caret - 2, caret)).toBeNull();
  });
  it("keeps code samples literal and supports the command after a closing fence", () => {
    for (const text of [
      "```\n/remind literal",
      "~~~md\n/remind literal",
      "    /remind literal",
    ])
      expect(
        documentReminderCommand(text, text.length, text.length),
      ).toBeNull();
    const text = "```\nexample\n```\n/remind 10m Take a break";
    expect(
      documentReminderCommand(text, text.length, text.length),
    ).toMatchObject({ content: "Take a break", delay: 10 });
  });
});
