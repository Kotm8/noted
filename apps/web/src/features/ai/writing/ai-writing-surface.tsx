import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowLeft, Check, Copy, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Markdown } from "../../notes/components/markdown";
import { AiSources, AiThinking } from "../components/ai-feedback";
import { PromptChooser } from "./prompt-chooser";
import { AiWritingError } from "./ai-writing-error";
import type { AiWritingController } from "./use-ai-writing";

export function AiWritingSurface({
  controller: ai,
  children,
}: {
  controller: AiWritingController;
  children: ReactNode;
}) {
  const result = ai.run.result;
  const snapshot = ai.snapshot;
  const whole =
    ai.options.place === "journals" ? "Whole entry" : "Whole document";
  return (
    <div
      className={`ai-writing-surface${ai.previewing ? " is-previewing" : ""}`}
      ref={ai.surface}
    >
      {ai.previewing && result && snapshot ? (
        <>
          <div className="ai-preview-banner">
            <Sparkles size={13} />
            <span>
              <strong>{result.name}</strong> preview. Editing resumes after
              Apply or Cancel.
            </span>
          </div>
          <div className="ai-inline-preview" aria-label="Rewrite preview">
            {snapshot.range.start > 0 && (
              <div className="ai-surrounding">
                <Markdown
                  content={snapshot.content.slice(0, snapshot.range.start)}
                />
              </div>
            )}
            <div className="ai-inline-diff">
              <del>
                {snapshot.content.slice(
                  snapshot.range.start,
                  snapshot.range.end,
                )}
              </del>
              <div
                className={`ai-replacement${ai.run.busy && result.text ? " streaming" : ""}`}
              >
                {!result.text ? (
                  <AiThinking result={result} />
                ) : (
                  <Markdown content={result.text} />
                )}
              </div>
            </div>
            {snapshot.range.end < snapshot.content.length && (
              <div className="ai-surrounding">
                <Markdown
                  content={snapshot.content.slice(snapshot.range.end)}
                />
              </div>
            )}
          </div>
          {(result.error || ai.conflict) && (
            <AiWritingError
              message={
                ai.conflict
                  ? "This entry changed on another device. Ask again before applying."
                  : result.error!
              }
              code={result.code}
            />
          )}
          <div className="ai-rewrite-bar">
            <span>{result.name}</span>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                ai.run.cancel();
                ai.setOpen(true);
              }}
            >
              <ArrowLeft size={13} />
              {ai.conflict ? "Ask again" : "Change prompt"}
            </Button>
            <Button size="small" variant="ghost" onClick={ai.cancel}>
              Cancel
            </Button>
            <Button
              size="small"
              disabled={result.stage !== "done" || ai.applying || ai.conflict}
              onClick={() => void ai.apply()}
            >
              {ai.applying
                ? "Applying…"
                : result.stage === "asking" || result.stage === "thinking"
                  ? "Thinking…"
                  : ai.run.busy
                    ? "Writing…"
                    : "Apply"}
            </Button>
          </div>
        </>
      ) : (
        children
      )}
      {ai.connected && !ai.open && !ai.previewing && ai.position !== null && (
        <button
          ref={ai.margin}
          type="button"
          className="ai-selection-button"
          style={{ top: ai.position }}
          aria-label="Ask AI about selected text"
          title={ai.online ? "Ask AI" : "AI needs a connection"}
          disabled={!ai.online}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => ai.show(true)}
        >
          <Sparkles size={14} />
        </button>
      )}
      <Popover.Root
        open={ai.open && ai.connected}
        onOpenChange={(open) => {
          if (!open) ai.cancel();
          else ai.setOpen(true);
        }}
      >
        <Popover.Anchor virtualRef={ai.anchor} />
        <Popover.Portal>
          <Popover.Content
            className="ask-ai-popover ai-writing-popover"
            aria-label="Ask AI"
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            <div className="ask-ai-heading">
              <Sparkles size={15} />
              <strong>Ask AI</strong>
              <button
                className="ai-scope-chip"
                type="button"
                disabled={!ai.selection}
                onClick={() => ai.setSelectedScope(!ai.selectedScope)}
              >
                {!ai.options.content.trim()
                  ? "Empty entry"
                  : ai.selectedScope
                    ? "Selected text"
                    : whole}
              </button>
            </div>
            {ai.fallback && (
              <p className="settings-hint">
                Couldn't match the selection exactly, so this uses the whole
                entry.
              </p>
            )}
            {result && result.kind === "answer" ? (
              <>
                <AiThinking result={result} />
                {result.error ? (
                  <AiWritingError message={result.error} code={result.code} />
                ) : (
                  <div
                    className={
                      ai.run.busy ? "ai-answer streaming" : "ai-answer"
                    }
                  >
                    <Markdown content={result.text} />
                  </div>
                )}
                <AiSources sources={result.sources} />
                {ai.conflict && (
                  <AiWritingError message="This entry changed on another device. Ask again before applying." />
                )}
                <div className="ai-answer-actions">
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => ai.run.cancel()}
                  >
                    <ArrowLeft size={13} />
                    Ask again
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={result.stage !== "done"}
                    onClick={() => void ai.addAnswer()}
                  >
                    <Plus size={13} />
                    Add to entry
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={result.stage !== "done"}
                    onClick={() => void ai.saveAnswer()}
                  >
                    <Check size={13} />
                    Save as new entry
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    disabled={!result.text}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(result.text)
                        .then(() => toast.success("Copied"))
                        .catch(() => toast.error("Could not copy"))
                    }
                  >
                    <Copy size={13} />
                    Copy
                  </Button>
                </div>
              </>
            ) : (
              <PromptChooser
                prompts={ai.prompts}
                prompt={ai.prompt}
                setPrompt={ai.setPrompt}
                kind={ai.kind}
                setKind={ai.setKind}
                answerOnly={!ai.options.content.trim()}
                onAsk={(saved) => void ai.ask(saved)}
              />
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
