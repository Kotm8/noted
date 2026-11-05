import { describe, expect, it } from "vitest";
import { defaultWorkSchedule, isDayOff } from "./work-schedule";

describe("work schedule", () => {
  it("supports selected weekdays including no days off or every day off", () => {
    expect(isDayOff("2026-11-07")).toBe(true);
    expect(isDayOff("2026-11-09")).toBe(false);
    expect(
      isDayOff("2026-11-09", { ...defaultWorkSchedule, off_weekdays: [0, 4] }),
    ).toBe(true);
    expect(
      isDayOff("2026-11-07", { ...defaultWorkSchedule, off_weekdays: [] }),
    ).toBe(false);
    expect(
      isDayOff("2026-11-09", {
        ...defaultWorkSchedule,
        off_weekdays: [0, 1, 2, 3, 4, 5, 6],
      }),
    ).toBe(true);
  });

  it("keeps rotating cycles across month boundaries and before the anchor", () => {
    const schedule = {
      ...defaultWorkSchedule,
      mode: "cycle" as const,
      cycle_start: "2026-10-31",
    };
    expect(
      [
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
      ].map((day) => isDayOff(day, schedule)),
    ).toEqual([true, true, false, false, true, true, false]);
    expect(
      isDayOff("2026-11-02", { ...schedule, work_days: 3, off_days: 1 }),
    ).toBe(false);
    expect(
      isDayOff("2026-11-03", { ...schedule, work_days: 3, off_days: 1 }),
    ).toBe(true);
  });

  it("prioritizes one-off changes without shifting the underlying cycle", () => {
    const schedule = {
      ...defaultWorkSchedule,
      mode: "cycle" as const,
      cycle_start: "2026-10-31",
      overrides: {
        "2026-10-31": "off" as const,
        "2026-11-02": "work" as const,
      },
    };
    expect(isDayOff("2026-10-31", schedule)).toBe(true);
    expect(isDayOff("2026-11-01", schedule)).toBe(false);
    expect(isDayOff("2026-11-02", schedule)).toBe(false);
    expect(isDayOff("2026-11-03", schedule)).toBe(true);
    expect(isDayOff("2026-11-02", { ...schedule, overrides: {} })).toBe(true);
  });
});
