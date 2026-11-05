import { addDays, wallTime } from "../../schedule/dates";
import type { PlanOccurrence } from "../../schedule/types";
import type { CalendarScope, PreviewPlan } from "./types";

export function previewOccurrence(
  plan: PreviewPlan,
  timezone: string,
): PlanOccurrence | null {
  try {
    return {
      ...plan,
      timezone,
      frequency: "none",
      weekdays: [],
      repeat_until: null,
      revision: 1,
      occurrence_date: plan.date,
      is_override: false,
      start_at: wallTime(plan.date, plan.start_minute, timezone),
      end_at: wallTime(
        plan.end_minute === 1440 ? addDays(plan.date, 1) : plan.date,
        plan.end_minute % 1440,
        timezone,
      ),
    };
  } catch {
    return null;
  }
}

export function proposalConflicts(
  proposals: PreviewPlan[],
  existing: PlanOccurrence[],
  scope: CalendarScope,
  activeIds: Set<string>,
  now = Date.now(),
): Map<string, string> {
  const conflicts = new Map<string, string>();
  for (const plan of proposals) {
    let start: number;
    let end: number;
    try {
      start = Date.parse(
        wallTime(plan.date, plan.start_minute, scope.timezone),
      );
      end = Date.parse(wallTime(plan.date, plan.end_minute, scope.timezone));
    } catch {
      conflicts.set(
        plan.id,
        "This time does not exist in the selected timezone.",
      );
      continue;
    }
    if (!activeIds.has(plan.activity_id))
      conflicts.set(plan.id, "Choose an active activity.");
    else if (!plan.title.trim())
      conflicts.set(plan.id, "Give this plan a title.");
    else if (plan.date < scope.start || plan.date > scope.end)
      conflicts.set(plan.id, "Outside the selected dates.");
    else if (
      plan.start_minute < scope.start_minute ||
      plan.end_minute > scope.end_minute ||
      plan.end_minute <= plan.start_minute
    )
      conflicts.set(plan.id, "Choose a time inside the planning hours.");
    else if (!Number.isFinite(start) || !Number.isFinite(end) || start < now)
      conflicts.set(
        plan.id,
        "The start time has passed. Choose a future time.",
      );
    else {
      const overlap = existing.find(
        (item) =>
          start < Date.parse(item.end_at) && end > Date.parse(item.start_at),
      );
      const another = proposals.find(
        (item) =>
          item.id !== plan.id &&
          item.selected &&
          item.date === plan.date &&
          plan.start_minute < item.end_minute &&
          plan.end_minute > item.start_minute,
      );
      if (overlap || another)
        conflicts.set(plan.id, `Overlaps ${overlap?.title ?? another?.title}.`);
    }
  }
  return conflicts;
}

export function findGap(
  plan: PreviewPlan,
  proposals: PreviewPlan[],
  existing: PlanOccurrence[],
  scope: CalendarScope,
): PreviewPlan | null {
  const length = plan.end_minute - plan.start_minute;
  if (length <= 0) return null;
  for (
    let minute = scope.start_minute;
    minute + length <= scope.end_minute;
    minute += 15
  ) {
    const candidate = {
      ...plan,
      start_minute: minute,
      end_minute: minute + length,
    };
    const conflicts = proposalConflicts(
      [...proposals.filter((item) => item.id !== plan.id), candidate],
      existing,
      scope,
      new Set([plan.activity_id]),
    );
    if (!conflicts.has(plan.id)) return candidate;
  }
  return null;
}
