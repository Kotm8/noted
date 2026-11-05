import { expect, it } from "vitest";
import type { AiPrompt } from "../api";
import { writingPrompts } from "./prompts";

const prompt = (
  name: string,
  kind: AiPrompt["kind"],
  places: AiPrompt["places"],
): AiPrompt => ({
  id: name,
  name,
  kind,
  places,
  instructions: "Help",
  sees: "selection",
  model: null,
  position: 0,
  revision: 1,
});

it("only offers writing results in the appropriate place", () => {
  const items = [
    prompt("Fix", "rewrite", ["journals"]),
    prompt("Reply", "reply", ["journals"]),
    prompt("Summary", "answer", ["journals"]),
    prompt("Draft", "draft", ["documents"]),
    prompt("Other", "answer", ["messages"]),
  ];
  expect(
    writingPrompts(items, "journals", false).map((item) => item.name),
  ).toEqual(["Fix", "Summary"]);
  expect(
    writingPrompts(items, "journals", false, true).map((item) => item.name),
  ).toEqual(["Summary"]);
});
it("offers only getting-started answers in empty writing", () => {
  const items = [
    prompt("Fix", "rewrite", ["journals"]),
    prompt("Weekly review", "answer", ["journals"]),
    prompt("Three questions to write about", "answer", ["journals"]),
    prompt("Outline from a title", "answer", ["journals"]),
  ];
  expect(
    writingPrompts(items, "journals", true).map((item) => item.name),
  ).toEqual(["Three questions to write about", "Outline from a title"]);
});
