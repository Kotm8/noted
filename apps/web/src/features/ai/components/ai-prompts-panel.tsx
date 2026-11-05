import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { ConfirmDialog } from "../../../components/ui/confirm-dialog";
import { Notice } from "../../../components/ui/notice";
import {
  aiApi,
  type AiKind,
  type AiPlace,
  type AiPrompt,
  type AiPromptFields,
} from "../api";
import { KINDS } from "../kinds";
import { useAiPrompts } from "../queries";

const PLACES: { value: AiPlace; label: string }[] = [
  { value: "messages", label: "Messages" },
  { value: "journals", label: "Journals" },
  { value: "documents", label: "Documents" },
  { value: "composer", label: "Composer" },
];
const BLANK: AiPromptFields = {
  name: "",
  instructions: "",
  kind: "rewrite",
  places: ["messages"],
  sees: "selection",
  model: null,
};

/** Settings › AI › Saved prompts: the list on the left, the chosen prompt on the right. */
export function AiPromptsPanel() {
  const client = useQueryClient();
  const prompts = useAiPrompts();
  const [selected, setSelected] = useState<string | null>(null);
  const items = prompts.data ?? [];
  const current =
    selected === "new"
      ? null
      : (items.find((item) => item.id === selected) ?? items[0]);
  const reorder = useMutation({
    mutationFn: aiApi.reorderPrompts,
    onSuccess: (list) => client.setQueryData(["ai-prompts"], list),
    onError: (error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ["ai-prompts"] });
    },
  });
  function move(index: number, by: number) {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    reorder.mutate(ids);
  }
  return (
    <section className="settings-panel ai-prompts">
      <div className="ai-prompts-heading">
        <div>
          <h2>Saved prompts</h2>
          <p>
            Pick these from Ask AI instead of typing the same request again.
          </p>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={() => setSelected("new")}
        >
          <Plus size={14} />
          New prompt
        </Button>
      </div>
      {prompts.isError && <Notice tone="error">{prompts.error.message}</Notice>}
      <div className="ai-prompts-layout">
        <ol className="ai-prompt-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={current?.id === item.id && selected !== "new"}
                onClick={() => setSelected(item.id)}
              >
                <span>{item.name}</span>
                <small>{KINDS[item.kind].label}</small>
              </button>
              <span className="ai-prompt-move">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === items.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={12} />
                </button>
              </span>
            </li>
          ))}
          {!items.length && !prompts.isPending && (
            <li className="settings-hint">No saved prompts yet.</li>
          )}
        </ol>
        {(current || selected === "new") && (
          <PromptEditor
            key={
              selected === "new" ? "new" : `${current!.id}:${current!.revision}`
            }
            prompt={selected === "new" ? null : current!}
            onSaved={(saved) => setSelected(saved?.id ?? null)}
          />
        )}
      </div>
    </section>
  );
}

function PromptEditor({
  prompt,
  onSaved,
}: {
  prompt: AiPrompt | null;
  onSaved: (prompt: AiPrompt | null) => void;
}) {
  const client = useQueryClient();
  const [fields, setFields] = useState<AiPromptFields>(prompt ?? BLANK);
  const [deleting, setDeleting] = useState(false);
  const change = (values: Partial<AiPromptFields>) =>
    setFields((old) => ({ ...old, ...values }));
  const save = useMutation({
    mutationFn: () =>
      prompt
        ? aiApi.updatePrompt({ ...prompt, ...fields })
        : aiApi.createPrompt(fields),
    onSuccess: async (saved) => {
      await client.invalidateQueries({ queryKey: ["ai-prompts"] });
      onSaved(saved);
      toast.success("Prompt saved");
    },
  });
  const remove = useMutation({
    mutationFn: () => aiApi.deletePrompt(prompt!.id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["ai-prompts"] });
      setDeleting(false);
      onSaved(null);
      toast.success("Prompt deleted");
    },
  });
  const saved = prompt
    ? (Object.keys(BLANK) as (keyof AiPromptFields)[]).map((key) => prompt[key])
    : null;
  const dirty =
    !saved ||
    JSON.stringify(saved) !==
      JSON.stringify(
        (Object.keys(BLANK) as (keyof AiPromptFields)[]).map(
          (key) => fields[key],
        ),
      );
  return (
    <form
      className="ai-prompt-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Name
        <input
          required
          maxLength={60}
          value={fields.name}
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <label>
        Instructions
        <textarea
          required
          rows={3}
          maxLength={4000}
          value={fields.instructions}
          onChange={(event) => change({ instructions: event.target.value })}
          placeholder="Fix spelling and grammar. Keep my wording."
        />
        <small>
          Plain words. Noted tells the AI how to hand back the result.
        </small>
      </label>
      <div className="ai-field">
        <span className="field-caption">Returns</span>
        <div className="ai-kind-grid" role="radiogroup" aria-label="Returns">
          {(Object.keys(KINDS) as AiKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={fields.kind === kind}
              onClick={() =>
                change({
                  kind,
                  places:
                    kind === "reply" || kind === "draft"
                      ? fields.places.filter(
                          (place) =>
                            place === "messages" || place === "composer",
                        )
                      : fields.places,
                })
              }
            >
              <strong>{KINDS[kind].label}</strong>
              <small>{KINDS[kind].hint}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="ai-field">
        <span className="field-caption">Shows up in</span>
        <div className="ai-places">
          {PLACES.map((place) => (
            <label key={place.value} className="check-label">
              <input
                type="checkbox"
                disabled={
                  (fields.kind === "reply" || fields.kind === "draft") &&
                  (place.value === "journals" || place.value === "documents")
                }
                checked={fields.places.includes(place.value)}
                onChange={(event) =>
                  change({
                    places: event.target.checked
                      ? [...fields.places, place.value]
                      : fields.places.filter((item) => item !== place.value),
                  })
                }
              />
              {place.label}
            </label>
          ))}
        </div>
      </div>
      <div className="ai-field">
        <span className="field-caption">Can see</span>
        <div className="ai-segmented" role="radiogroup" aria-label="Can see">
          <button
            type="button"
            role="radio"
            aria-checked={fields.sees === "selection"}
            onClick={() => change({ sees: "selection" })}
          >
            Only what's selected
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={fields.sees === "channel_today"}
            onClick={() => change({ sees: "channel_today" })}
          >
            Also the rest of the channel today
          </button>
        </div>
      </div>
      <label>
        Model
        <input
          list="ai-models"
          maxLength={80}
          value={fields.model ?? ""}
          placeholder="Default from AI settings"
          onChange={(event) =>
            change({ model: event.target.value.trim() || null })
          }
        />
      </label>
      {(save.error || remove.error) && (
        <Notice tone="error">{(save.error ?? remove.error)?.message}</Notice>
      )}
      <div className="ai-editor-actions">
        {prompt && (
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} />
            Delete
          </Button>
        )}
        <span />
        <Button
          type="submit"
          size="small"
          disabled={
            save.isPending ||
            !dirty ||
            !fields.name.trim() ||
            !fields.instructions.trim()
          }
        >
          {save.isPending ? "Saving…" : prompt ? "Save prompt" : "Add prompt"}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        pending={remove.isPending}
        title={`Delete ${prompt?.name ?? "this prompt"}?`}
        description="Past runs stay in History."
        keepLabel="Keep prompt"
        confirmLabel="Delete prompt"
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
      />
    </form>
  );
}
