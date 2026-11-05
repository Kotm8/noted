import { useMemo } from "react";
import {
  useMutationState,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { User } from "../auth/types";
import { scheduleApi } from "./api";
import {
  applyLocalWrite,
  validateLocalPlan,
  type ScheduleWrite,
} from "./local-plans";
import type {
  PlanFields,
  PlanOccurrence,
  ScheduleBoard,
  SchedulePlan,
} from "./types";
import type { ScheduleHistory } from "./use-schedule-history";

const confirmed = new WeakMap<QueryClient, Map<string, SchedulePlan>>();

function receipts(client: QueryClient) {
  let records = confirmed.get(client);
  if (!records) {
    records = new Map();
    confirmed.set(client, records);
  }
  return records;
}

function patchBoards(client: QueryClient, write: ScheduleWrite) {
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: ["schedule"] })) {
    const key = query.queryKey;
    const offset = key[1] === "ai-context" ? 2 : 1;
    const first = String(key[offset] ?? write.plan.date).slice(0, 10);
    const last = String(key[offset + 1] ?? write.plan.date).slice(0, 10);
    client.setQueryData<ScheduleBoard>(
      key,
      (board) => board && applyLocalWrite(board, write, first, last),
    );
  }
}

export function useScheduleWrites(history: ScheduleHistory) {
  const client = useQueryClient();
  const owner = client.getQueryData<User>(["session"])?.id ?? "";
  const states = useMutationState({
    filters: { mutationKey: ["schedule-write", owner] },
    select: (mutation) => ({
      id: mutation.mutationId,
      status: mutation.state.status,
      write: mutation.state.variables as ScheduleWrite,
      error: mutation.state.error as Error | null,
    }),
  });
  const pending = useMemo(
    () =>
      states
        .filter((state) => state.status === "pending")
        .map((state) => {
          const known = receipts(client).get(state.write.plan.id);
          return known
            ? {
                ...state,
                write: {
                  ...state.write,
                  plan: {
                    ...state.write.plan,
                    id: known.id,
                    revision: Math.max(
                      known.revision,
                      state.write.plan.revision,
                    ),
                  },
                },
              }
            : state;
        }),
    [client, states],
  );
  const failures = useMemo(
    () => states.filter((state) => state.status === "error"),
    [states],
  );

  function forget(id: number) {
    const mutation = client
      .getMutationCache()
      .getAll()
      .find((item) => item.mutationId === id);
    if (mutation) client.getMutationCache().remove(mutation);
  }

  function submit(write: ScheduleWrite) {
    void client.cancelQueries({ queryKey: ["schedule"] });
    const queueId =
      [...receipts(client)].find(
        ([, plan]) => plan.id === write.plan.id,
      )?.[0] ?? write.plan.id;
    const mutation = client
      .getMutationCache()
      .build<SchedulePlan, Error, ScheduleWrite, unknown>(client, {
        mutationKey: ["schedule-write", owner],
        scope: { id: `schedule-plan:${owner}:${queueId}` },
        retry: false,
        gcTime: Infinity,
        mutationFn: async (next) => {
          if (client.getQueryData<User>(["session"])?.id !== next.owner)
            throw new Error(
              "Sign in to the same account before saving this plan.",
            );
          const previous = receipts(client).get(next.plan.id);
          const targetId = previous?.id ?? next.plan.id;
          const revision = Math.max(
            next.plan.revision,
            previous?.revision ?? 0,
          );
          if (next.kind === "create" && !previous)
            return scheduleApi.create({
              ...next.plan,
              client_id: next.plan.id,
            });
          if (revision < 1)
            throw new Error(
              "Save the new plan before changing it again. Your changes are kept here.",
            );
          if (next.kind === "delete")
            return scheduleApi.remove(
              targetId,
              revision,
              next.scope === "occurrence"
                ? next.original?.occurrence_date
                : undefined,
            );
          return scheduleApi.update(targetId, {
            ...next.plan,
            revision,
            scope: next.scope,
            occurrence_date: next.original?.occurrence_date,
          });
        },
        onSuccess: (plan, next) => {
          if (client.getQueryData<User>(["session"])?.id !== next.owner) return;
          const created =
            next.kind === "create" && !receipts(client).has(plan.id);
          const undoable =
            created ||
            next.kind === "delete" ||
            Boolean(
              next.original &&
              (next.scope === "occurrence" ||
                next.original.frequency === "none"),
            );
          receipts(client).set(next.plan.id, plan);
          receipts(client).set(plan.id, plan);
          for (const older of client
            .getMutationCache()
            .findAll({ mutationKey: ["schedule-write", owner] })) {
            const failed = older.state.variables as ScheduleWrite;
            if (
              older.state.status === "error" &&
              (failed.plan.id === next.plan.id || failed.plan.id === plan.id)
            )
              client.getMutationCache().remove(older);
          }
          client.setQueryData(["schedule-plan", plan.id], plan);
          if (next.plan.id !== plan.id)
            patchBoards(client, { ...next, kind: "delete", scope: "series" });
          patchBoards(client, {
            ...next,
            plan:
              next.scope === "occurrence"
                ? { ...next.plan, id: plan.id, revision: plan.revision }
                : plan,
          });
          if (created) history.created(plan, next.label);
          else if (next.kind === "delete" && next.original)
            history.deleted(
              { ...next.original, id: plan.id },
              plan,
              next.scope === "occurrence",
            );
          else if (next.original && undoable)
            history.changed(
              { ...next.original, id: plan.id },
              { ...next.plan, scope: next.scope },
            );
          toast.success(
            next.kind === "delete"
              ? "Plan deleted"
              : next.label === "the move"
                ? "Plan updated"
                : next.label === "the copy"
                  ? "Plan copied"
                  : created
                    ? "Plan added"
                    : "Plan saved",
            undoable ? history.undoToast() : undefined,
          );
        },
        onSettled: (data, error) => {
          void client.invalidateQueries({ queryKey: ["schedule"] });
          void client.invalidateQueries({ queryKey: ["home-activity"] });
          if (data && !error)
            setTimeout(() => client.getMutationCache().remove(mutation), 0);
        },
      });
    void mutation.execute(write).catch(() => undefined);
  }

  function save(
    fields: PlanFields,
    original?: PlanOccurrence,
    scope: "series" | "occurrence" = original?.frequency !== "none" && original
      ? "occurrence"
      : "series",
    label = "adding the plan",
  ) {
    validateLocalPlan(fields, scope);
    const id = original?.id ?? crypto.randomUUID();
    submit({
      id: crypto.randomUUID(),
      owner,
      kind: original && original.revision > 0 ? "update" : "create",
      plan: { ...fields, id, revision: original?.revision ?? 0 },
      original,
      scope,
      label,
    });
  }
  function remove(original: PlanOccurrence, occurrence = false) {
    submit({
      id: crypto.randomUUID(),
      owner,
      kind: "delete",
      plan: original,
      original,
      scope: occurrence ? "occurrence" : "series",
      label: "the delete",
    });
  }
  function retry(id: number, write: ScheduleWrite) {
    forget(id);
    submit({ ...write, id: crypto.randomUUID() });
  }

  return { save, remove, pending, failures, retry, forget };
}

export type ScheduleWrites = ReturnType<typeof useScheduleWrites>;
