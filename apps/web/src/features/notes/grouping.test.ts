import { describe, expect, it } from "vitest";
import { noteGrouping } from "./grouping";

describe("note grouping", () => {
  it("starts a group for the first note and after a pause longer than two minutes", () => {
    expect(noteGrouping("2026-10-16T13:43:00Z").startsGroup).toBe(true);
    expect(noteGrouping("2026-10-16T13:45:00Z", "2026-10-16T13:43:00Z").startsGroup).toBe(false);
    expect(noteGrouping("2026-10-16T13:45:01Z", "2026-10-16T13:43:00Z").startsGroup).toBe(true);
  });

  it("marks a minute change without splitting closely timed notes into separate groups", () => {
    expect(noteGrouping("2026-10-16T13:43:59Z", "2026-10-16T13:43:10Z")).toEqual({
      startsGroup: false, startsMinute: false, startsNewDay: false,
    });
    expect(noteGrouping("2026-10-16T13:44:00Z", "2026-10-16T13:43:59Z")).toEqual({
      startsGroup: false, startsMinute: true, startsNewDay: false,
    });
  });

  it("always separates local calendar days, even one second apart", () => {
    const before = new Date(2026, 9, 16, 23, 59, 59).toISOString();
    const after = new Date(2026, 9, 17, 0, 0, 0).toISOString();
    expect(noteGrouping(after, before)).toEqual({
      startsGroup: true, startsMinute: true, startsNewDay: true,
    });
  });
});
