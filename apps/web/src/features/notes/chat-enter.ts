import type { KeyboardEvent } from "react";
import { applyEdit, listEnter } from "../../lib/list-editing";

/**
 * Enter in chat-style text boxes. Inside a list, Enter (or Shift+Enter) adds
 * the next item and Enter on an empty item ends the list. Otherwise Enter
 * submits and Shift+Enter adds a line. Ctrl/Cmd+Enter always submits.
 */
export function chatEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  const input = event.currentTarget;
  const send = event.ctrlKey || event.metaKey;
  const edit = send
    ? null
    : listEnter(input.value, input.selectionStart, input.selectionEnd);
  if (edit) {
    event.preventDefault();
    applyEdit(input, edit);
  } else if (send || !event.shiftKey) {
    event.preventDefault();
    if (!event.repeat) submit();
  }
}
