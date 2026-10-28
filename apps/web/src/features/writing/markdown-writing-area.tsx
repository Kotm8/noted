import { useRef } from "react";
import { applyEdit, listEnter } from "../../lib/list-editing";
import { Markdown } from "../notes/components/markdown";
import { useMentionPicker } from "../notes/components/mention-picker";
import { useMentionDirectory } from "../notes/mention-context";
import { toEditable, toStored } from "../notes/mentions";
import { useFormatting } from "./use-formatting";

export function MarkdownWritingArea({
  content,
  onChange,
  editing,
  pending,
  label,
  onEdit,
}: {
  content: string;
  onChange: (content: string) => void;
  editing: boolean;
  pending: boolean;
  label: string;
  onEdit: () => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { channels } = useMentionDirectory();
  const shown = toEditable(content, channels);
  const mentions = useMentionPicker(textarea, shown.text, shown.refs, true);
  for (const [name, id] of shown.refs) mentions.refs.current.set(name, id);
  const change = (text: string) =>
    onChange(toStored(text, mentions.refs.current));
  const formatting = useFormatting(textarea);

  return (
    <>
      {editing && formatting.toolbar}
      {formatting.dialog}
      {editing ? (
        <div className="writing-input">
          {mentions.menu}
          <textarea
            autoFocus
            ref={textarea}
            className="journal-entry-body"
            aria-label={label}
            placeholder="Start writing…"
            maxLength={200000}
            value={shown.text}
            onChange={(event) => change(event.target.value)}
            onSelect={mentions.onSelect}
            onKeyDown={(event) => {
              if (mentions.onKeyDown(event) || formatting.onKeyDown(event))
                return;
              const input = event.currentTarget;
              const edit =
                event.key === "Enter" && !event.nativeEvent.isComposing
                  ? listEnter(
                      input.value,
                      input.selectionStart,
                      input.selectionEnd,
                    )
                  : null;
              if (!edit) return;
              event.preventDefault();
              applyEdit(input, edit);
            }}
          />
        </div>
      ) : (
        <div className="journal-reading">
          <Markdown
            content={content}
            pending={pending}
            onContentChange={onChange}
          />
          {!content && (
            <button className="journal-start-writing" onClick={onEdit}>
              Start writing…
            </button>
          )}
        </div>
      )}
    </>
  );
}
