import type { AiPlace, AiPrompt } from "../api";

const EMPTY_STARTERS = new Set([
  "Three questions to write about",
  "Outline from a title",
]);

export function writingPrompts(
  prompts: AiPrompt[],
  place: AiPlace,
  empty: boolean,
  answerOnly = false,
) {
  return prompts.filter(
    (prompt) =>
      prompt.places.includes(place) &&
      (prompt.kind === "answer" ||
        (!answerOnly && prompt.kind === "rewrite")) &&
      (!empty || (prompt.kind === "answer" && EMPTY_STARTERS.has(prompt.name))),
  );
}
