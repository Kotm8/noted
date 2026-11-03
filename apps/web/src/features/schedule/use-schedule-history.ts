import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { scheduleApi } from "./api";
import type { PlanOccurrence, PlanUpdate, SchedulePlan } from "./types";

interface Step {
  label: string;
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
}

const LIMIT = 50;

function typing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Undo and redo for calendar changes, with Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y). Steps look up
 * each plan's revision when they run instead of keeping the one they started with, so edits
 * made in between, here or on another device, don't make an older step fail.
 */
export function useScheduleHistory() {
  const client = useQueryClient();
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);
  const busy = useRef(false);
  const deletedRevisions = useRef(new Map<string, number>());
  const lastToast = useRef<string | null>(null);

  async function revision(id: string) {
    const deleted = deletedRevisions.current.get(id);
    if (deleted !== undefined) return deleted;
    return (await scheduleApi.get(id)).revision;
  }
  function settle(plan: SchedulePlan, deleted: boolean) {
    if (deleted) deletedRevisions.current.set(plan.id, plan.revision);
    else deletedRevisions.current.delete(plan.id);
  }
  const removePlan = async (id: string) =>
    settle(await scheduleApi.remove(id, await revision(id)), true);
  const restorePlan = async (id: string) =>
    settle(await scheduleApi.restore(id, await revision(id)), false);
  /** Puts an occurrence back to exactly how it was: following the series, or overridden. */
  async function restoreOccurrence(original: PlanOccurrence) {
    if (original.is_override)
      await scheduleApi.update(original.id, {
        ...original,
        revision: await revision(original.id),
        scope: "occurrence",
      });
    else
      await scheduleApi.remove(
        original.id,
        await revision(original.id),
        original.occurrence_date,
        true,
      );
  }

  function record(step: Step) {
    past.current = [...past.current, step].slice(-LIMIT);
    future.current = [];
  }
  async function run(
    from: typeof past,
    to: typeof past,
    direction: "undo" | "redo",
  ) {
    const step = from.current.at(-1);
    if (!step || busy.current) return;
    busy.current = true;
    try {
      await step[direction]();
      from.current = from.current.slice(0, -1);
      to.current = [...to.current, step];
      toast(
        direction === "undo" ? `Undid ${step.label}` : `Redid ${step.label}`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      busy.current = false;
      void client.invalidateQueries({ queryKey: ["schedule"] });
    }
  }
  const undo = () => run(past, future, "undo");
  const redo = () => run(future, past, "redo");

  const shortcuts = useRef({ undo, redo });
  shortcuts.current = { undo, redo };
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (typing(event.target) || document.querySelector('[role="dialog"]'))
        return;
      const letter = event.key.toLowerCase();
      if (letter === "z" && !event.shiftKey) {
        event.preventDefault();
        void shortcuts.current.undo();
      } else if ((letter === "z" && event.shiftKey) || letter === "y") {
        event.preventDefault();
        void shortcuts.current.redo();
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  return {
    undo,
    redo,
    /** Toast options for an undoable change. Showing one dismisses the last, so the Undo
     * on screen always belongs to the latest change. */
    undoToast() {
      if (lastToast.current !== null) toast.dismiss(lastToast.current);
      lastToast.current = crypto.randomUUID();
      return {
        id: lastToast.current,
        action: { label: "Undo", onClick: () => void undo() },
      };
    },
    /** A plan that now exists, from drawing, the dialog, or a copy. */
    created(plan: SchedulePlan, label = "adding the plan") {
      record({
        label,
        undo: () => removePlan(plan.id),
        redo: () => restorePlan(plan.id),
      });
    },
    /** A move or resize. `changes` holds the new times, applied the same way on redo. */
    changed(original: PlanOccurrence, changes: Partial<PlanUpdate>) {
      const scope = original.frequency === "none" ? "series" : "occurrence";
      record({
        label: "the move",
        undo: async () => {
          if (scope === "occurrence") await restoreOccurrence(original);
          else
            await scheduleApi.update(original.id, {
              ...original,
              revision: await revision(original.id),
              scope,
            });
        },
        redo: async () =>
          scheduleApi.update(original.id, {
            ...original,
            ...changes,
            revision: await revision(original.id),
            scope,
            occurrence_date: original.occurrence_date,
          }),
      });
    },
    /** A deleted one-off plan or series, or a single deleted occurrence. */
    deleted(
      original: PlanOccurrence,
      result: SchedulePlan,
      occurrence: boolean,
    ) {
      if (!occurrence) settle(result, true);
      record({
        label: "the delete",
        undo: () =>
          occurrence ? restoreOccurrence(original) : restorePlan(original.id),
        redo: async () =>
          occurrence
            ? scheduleApi.remove(
                original.id,
                await revision(original.id),
                original.occurrence_date,
              )
            : removePlan(original.id),
      });
    },
  };
}

export type ScheduleHistory = ReturnType<typeof useScheduleHistory>;
