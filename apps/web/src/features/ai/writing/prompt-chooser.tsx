import { ArrowUp, Sparkles } from "lucide-react";
import type { AiKind, AiPrompt } from "../api";

export function PromptChooser({
  prompts,
  prompt,
  setPrompt,
  kind,
  setKind,
  onAsk,
  placeholder = "Ask about your writing",
  answerOnly = false,
}: {
  prompts: AiPrompt[];
  prompt: string;
  setPrompt: (value: string) => void;
  kind: AiKind;
  setKind: (value: AiKind) => void;
  onAsk: (saved?: AiPrompt) => void;
  placeholder?: string;
  answerOnly?: boolean;
}) {
  return (
    <>
      {prompts.length > 0 && (
        <div className="ask-ai-saved">
          <span className="field-caption">Saved prompts</span>
          {prompts.map((item) => (
            <button key={item.id} type="button" onClick={() => onAsk(item)}>
              <span>{item.name}</span>
              <small>{item.kind === "rewrite" ? "Rewrite" : "Answer"}</small>
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (prompt.trim()) onAsk();
        }}
      >
        <label className="ai-writing-prompt">
          <Sparkles size={15} />
          <textarea
            rows={1}
            aria-label="AI prompt"
            placeholder={placeholder}
            value={prompt}
            maxLength={4000}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (prompt.trim()) onAsk();
              }
            }}
          />
          <button
            type="submit"
            className="ask-ai-run"
            aria-label="Ask"
            disabled={!prompt.trim()}
          >
            <ArrowUp size={16} />
          </button>
        </label>
        {!answerOnly && (
          <div
            className="ask-ai-kinds"
            role="radiogroup"
            aria-label="What it returns"
          >
            {(["rewrite", "answer"] as const).map((value) => (
              <button
                key={value}
                role="radio"
                type="button"
                aria-checked={kind === value}
                onClick={() => setKind(value)}
              >
                {value === "rewrite" ? "Rewrite" : "Answer"}
              </button>
            ))}
          </div>
        )}
      </form>
    </>
  );
}
