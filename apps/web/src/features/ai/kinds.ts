import type { AiKind } from "./api";

export const KINDS: Record<AiKind, { label: string; hint: string }> = {
  rewrite: { label: "Rewrite", hint: "Edits the selected text" },
  reply: { label: "Reply", hint: "Answers in a thread reply" },
  draft: { label: "Draft", hint: "Puts a draft in the composer" },
  answer: {
    label: "Answer",
    hint: "Shows an answer, saved only if you choose",
  },
};
