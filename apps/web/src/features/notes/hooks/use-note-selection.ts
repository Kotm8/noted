import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

function typing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Selecting messages happens only in the gutter left of their times: a click picks one,
 * dragging down the gutter sweeps a range, and Shift-click extends from the last pick.
 * Clicking the text never selects, so ordinary text selection keeps working.
 */
export function useNoteSelection(
  ids: string[],
  actions: { copy: () => void; remove: () => void },
) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const order = useRef(ids);
  order.current = ids;
  const latest = useRef(actions);
  latest.current = actions;

  // Messages that disappear, deleted here or on another device, leave the selection.
  useEffect(() => {
    setSelected((current) => {
      const kept = [...current].filter((id) => ids.includes(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [ids]);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const between = (from: string, to: string) => {
    const list = order.current;
    const [first, last] = [list.indexOf(from), list.indexOf(to)].sort(
      (a, b) => a - b,
    );
    return first < 0 ? [to] : list.slice(first, last + 1);
  };

  function press(id: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.shiftKey && anchor.current) {
      const range = between(anchor.current, id);
      setSelected((current) => new Set([...current, ...range]));
      anchor.current = id;
      return;
    }
    const before = new Set(selected);
    const x = event.clientX;
    let moved = false;
    const sweep = (move: PointerEvent) => {
      const over = document
        .elementFromPoint(x, move.clientY)
        ?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId;
      if (!over) return;
      moved ||= over !== id;
      setSelected(new Set([...before, ...between(id, over)]));
    };
    const up = () => {
      document.removeEventListener("pointermove", sweep);
      if (!moved) {
        const next = new Set(before);
        if (before.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
      }
      anchor.current = id;
    };
    setSelected(new Set([...before, id]));
    document.addEventListener("pointermove", sweep);
    document.addEventListener("pointerup", up, { once: true });
  }

  const active = selected.size > 0;
  useEffect(() => {
    if (!active) return;
    function key(event: KeyboardEvent) {
      if (typing(event.target) || document.querySelector('[role="dialog"]'))
        return;
      if (event.key === "Escape") clear();
      else if (event.key === "Delete") {
        event.preventDefault();
        latest.current.remove();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "c" &&
        !getSelection()?.toString()
      ) {
        event.preventDefault();
        latest.current.copy();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [active, clear]);

  return { selected, press, clear };
}

export type NoteSelection = ReturnType<typeof useNoteSelection>;
