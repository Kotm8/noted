import { useState } from "react";
import type { Note } from "../notes/types";
import type { Channel } from "../workspaces/types";
import { AskAi, type AiPreview } from "./components/ask-ai";
import { useAiStatus } from "./queries";

export function useMessageAi(
  channel: Channel,
  onDraft: (text: string) => void,
) {
  const status = useAiStatus();
  const [target, setTarget] = useState<{
    note: Note;
    anchor: HTMLElement;
  } | null>(null);
  const [preview, setPreview] = useState<AiPreview | null>(null);

  return {
    preview,
    ask: status.data?.connected
      ? (note: Note, anchor: HTMLElement) => setTarget({ note, anchor })
      : undefined,
    popover: target && (
      <AskAi
        key={target.note.id}
        channel={channel}
        notes={[target.note]}
        selected={new Set([target.note.id])}
        anchor={target.anchor}
        onPreview={setPreview}
        onDraft={onDraft}
        onDone={() => setTarget(null)}
        onClose={() => setTarget(null)}
      />
    ),
  };
}
