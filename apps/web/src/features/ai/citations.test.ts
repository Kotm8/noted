import { describe, expect, it } from "vitest";
import { cleanCitations } from "./citations";

const path =
  "/w/11111111-1111-1111-1111-111111111111/c/22222222-2222-2222-2222-222222222222";

describe("cleanCitations", () => {
  it("drops model citation markers", () => {
    expect(cleanCitations("Oats are filling citeturn0search1.")).toBe(
      "Oats are filling.",
    );
    expect(cleanCitations("You trained twice【4†source】.")).toBe(
      "You trained twice.",
    );
    expect(cleanCitations("As noted [1], it works.")).toBe(
      "As noted, it works.",
    );
  });

  it("turns bare Noted paths into links and keeps existing ones", () => {
    expect(cleanCitations(`See ${path}?message=3 for it`)).toBe(
      `See [note](${path}?message=3) for it`,
    );
    expect(cleanCitations(`See [Monday](${path}).`)).toBe(
      `See [Monday](${path}).`,
    );
  });
});
