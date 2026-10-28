const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])( +)(\[[ xX]\] +)?/;

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * What Enter should do inside a Markdown list: start the next bullet, number,
 * or unchecked task at the same indentation, or end the list on an empty item.
 * Returns null when the caret is not in a list item.
 */
export function listEnter(
  value: string,
  start: number,
  end: number,
): TextEdit | null {
  if (start !== end) return null;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", start);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const match = LIST_ITEM.exec(line);
  if (!match || start < lineStart + match[0].length) return null;

  const [prefix, indent, marker, space, task] = match;
  if (!line.slice(prefix.length).trim())
    return { start: lineStart, end: lineEnd, text: "" };

  const number = Number.parseInt(marker, 10);
  const next = Number.isNaN(number)
    ? marker
    : `${number + 1}${marker.slice(-1)}`;
  return {
    start,
    end,
    text: `\n${indent}${next}${space}${task ? "[ ] " : ""}`,
  };
}

export function inList(value: string, caret: number): boolean {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  return LIST_ITEM.test(value.slice(lineStart, caret + 1));
}

/** Replace text in a textarea the way typing would, keeping undo history and React's onChange. */
export function applyEdit(input: HTMLTextAreaElement, edit: TextEdit) {
  input.focus();
  input.setSelectionRange(edit.start, edit.end);
  const applied = edit.text
    ? document.execCommand("insertText", false, edit.text)
    : edit.start === edit.end || document.execCommand("delete");
  if (applied) return;
  input.setRangeText(edit.text, edit.start, edit.end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
