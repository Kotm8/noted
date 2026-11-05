import { addDays, wallTime, weekDays } from "./dates";
import type {
  PlanFields,
  PlanOccurrence,
  ScheduleBoard,
  SchedulePlan,
} from "./types";

export interface ScheduleWrite {
  id: string;
  owner: string;
  kind: "create" | "update" | "delete";
  plan: SchedulePlan;
  original?: PlanOccurrence;
  scope: "series" | "occurrence";
  label: string;
}

function occurs(plan: PlanFields, date: string) {
  if (date < plan.date || (plan.repeat_until && date > plan.repeat_until))
    return false;
  if (plan.frequency === "none") return date === plan.date;
  if (plan.frequency === "daily") return true;
  if (plan.frequency === "monthly") return date.slice(8) === plan.date.slice(8);
  const day = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  if (!plan.weekdays.includes(day)) return false;
  const weeks = Math.round(
    (Date.parse(weekDays(date)[0]) - Date.parse(weekDays(plan.date)[0])) /
      604800000,
  );
  return plan.frequency === "weekly" || weeks % 2 === 0;
}

export function localOccurrence(
  plan: SchedulePlan,
  date: string,
  occurrence = date,
): PlanOccurrence | null {
  try {
    return {
      ...plan,
      date,
      occurrence_date: occurrence,
      series_date: plan.date,
      is_override: occurrence !== date,
      start_at: wallTime(date, plan.start_minute, plan.timezone),
      end_at: wallTime(date, plan.end_minute, plan.timezone),
    };
  } catch {
    return null;
  }
}

export function applyLocalWrite(
  board: ScheduleBoard,
  write: ScheduleWrite,
  first: string,
  last: string,
  timezone = write.plan.timezone,
): ScheduleBoard {
  const start = Date.parse(wallTime(first, 0, timezone));
  const end = Date.parse(wallTime(addDays(last, 1), 0, timezone));
  const visible = (plan: PlanOccurrence) =>
    Date.parse(plan.start_at) < end && Date.parse(plan.end_at) > start;
  const plans = board.plans.filter(
    (plan) =>
      plan.id !== write.plan.id ||
      (write.scope === "occurrence" &&
        plan.occurrence_date !== write.original?.occurrence_date),
  );
  if (write.kind !== "delete") {
    if (write.scope === "occurrence") {
      const occurrence = localOccurrence(
        write.plan,
        write.plan.date,
        write.original?.occurrence_date,
      );
      if (occurrence && visible(occurrence))
        plans.push({
          ...occurrence,
          series_date: write.original?.series_date ?? write.plan.date,
          is_override: true,
        });
    } else {
      for (
        let date = addDays(first, -1);
        date <= addDays(last, 1);
        date = addDays(date, 1)
      ) {
        if (!occurs(write.plan, date)) continue;
        const occurrence = localOccurrence(write.plan, date);
        if (occurrence && visible(occurrence)) plans.push(occurrence);
      }
    }
  }
  return { ...board, plans };
}

export function validateLocalPlan(
  fields: PlanFields,
  scope: "series" | "occurrence" = "series",
) {
  if (!fields.title.trim()) throw new Error("Give this plan a title.");
  if (fields.end_minute <= fields.start_minute)
    throw new Error("End time must follow start time.");
  if (
    scope === "series" &&
    fields.repeat_until &&
    fields.repeat_until < fields.date
  )
    throw new Error("Repeat end must follow the start date.");
  if (
    ["weekly", "biweekly"].includes(fields.frequency) &&
    !fields.weekdays.length
  )
    throw new Error("Choose at least one weekday.");
  wallTime(fields.date, fields.start_minute, fields.timezone);
  wallTime(fields.date, fields.end_minute, fields.timezone);
}
