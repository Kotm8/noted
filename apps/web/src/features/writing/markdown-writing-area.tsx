import { useRef } from "react";
import { Bold, Italic, ListTodo } from "lucide-react";
import { Markdown } from "../notes/components/markdown";

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
  function format(kind: "bold" | "italic" | "task") {
    const input = textarea.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end } = input;
    const selected = content.slice(start, end);
    const inserted =
      kind === "bold"
        ? `**${selected || "text"}**`
        : kind === "italic"
          ? `*${selected || "text"}*`
          : `- [ ] ${selected || "Task"}`;
    onChange(content.slice(0, start) + inserted + content.slice(end));
    input.focus();
    requestAnimationFrame(() =>
      input.setSelectionRange(start, start + inserted.length),
    );
  }
  return (
    <>
      {editing && (
        <div
          className="markdown-format-tools"
          role="toolbar"
          aria-label="Markdown formatting"
        >
          <button
            className="icon-button"
            type="button"
            aria-label="Bold"
            onClick={() => format("bold")}
          >
            <Bold size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Italic"
            onClick={() => format("italic")}
          >
            <Italic size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Checklist"
            onClick={() => format("task")}
          >
            <ListTodo size={15} />
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          ref={textarea}
          className="journal-entry-body"
          aria-label={label}
          placeholder="Start writing…"
          maxLength={200000}
          value={content}
          onChange={(event) => onChange(event.target.value)}
        />
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
