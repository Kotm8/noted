import type { WorkSchedule } from "./types";

export const defaultWorkSchedule: WorkSchedule = {
  mode: "weekly",
  off_weekdays: [5, 6],
  work_days: 2,
  off_days: 2,
  cycle_start: null,
  overrides: {},
};

export function isDayOff(
  date: string,
  schedule = defaultWorkSchedule,
): boolean {
  const override = schedule.overrides[date];
  if (override) return override === "off";
  const day = new Date(`${date}T00:00:00Z`);
  if (schedule.mode === "cycle" && schedule.cycle_start) {
    const distance = Math.round(
      (day.getTime() - Date.parse(`${schedule.cycle_start}T00:00:00Z`)) /
        86_400_000,
    );
    const length = schedule.work_days + schedule.off_days;
    return ((distance % length) + length) % length >= schedule.work_days;
  }
  return schedule.off_weekdays.includes((day.getUTCDay() + 6) % 7);
}
