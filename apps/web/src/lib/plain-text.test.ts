import { describe, expect, it } from "vitest";
import { plainText } from "./plain-text";

describe("plainText", () => {
  it("removes formatting marks and keeps the words", () => {
    expect(plainText("**Bold**, _soft_, ~~gone~~ and `code`")).toBe(
      "Bold, soft, gone and code",
    );
    expect(plainText("## Plan\n\n> quoted\n\n---\n\nafter")).toBe(
      "Plan\n\nquoted\n\n———\n\nafter",
    );
  });

  it("turns mentions, links and lists into readable text", () => {
    expect(
      plainText(
        "See <#0b7c3a1e-2f4d-4e6a-9c1b-2a3d4e5f6a7b|ideas> and [the doc](https://a.b/c)\n- one\n- [ ] todo\n- [x] done",
      ),
    ).toBe("See #ideas and the doc (https://a.b/c)\n• one\n☐ todo\n☑ done");
  });

  it("keeps code blocks as they are", () => {
    expect(plainText("Run:\n```sh\nnpm run **build**\n```")).toBe(
      "Run:\nnpm run **build**",
    );
  });

  it("leaves snake_case and multiplication alone", () => {
    expect(plainText("snake_case_name and 2*3*4")).toBe(
      "snake_case_name and 2*3*4",
    );
  });
});
