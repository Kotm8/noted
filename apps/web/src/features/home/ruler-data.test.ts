import { describe, expect, it } from "vitest";
import { daySegment, occupiedMinutes, trackedSeconds } from "./ruler-data";

describe("Home day ruler", () => {
  it("does not double count overlapping plans or include time outside the remaining day", () => {
    const plans = [
      { start: 540, end: 660 },
      { start: 600, end: 720 },
      { start: 780, end: 840 },
    ];
    expect(occupiedMinutes(plans)).toBe(240);
    expect(occupiedMinutes(plans, 630, 810)).toBe(120);
  });

  it("clips overnight plans to the account's local day and excludes a midnight endpoint", () => {
    expect(
      daySegment(
        "2026-11-12T20:00:00Z",
        "2026-11-13T02:00:00Z",
        "2026-11-13",
        "Europe/Moscow",
      ),
    ).toEqual({ start: 0, end: 300 });
    expect(
      daySegment(
        "2026-11-12T19:00:00Z",
        "2026-11-12T21:00:00Z",
        "2026-11-13",
        "Europe/Moscow",
      ),
    ).toBeNull();
  });

  it("counts today's part of an overnight session and caps a running session at now", () => {
    const sessions = [
      { started_at: "2026-11-12T20:30:00Z", ended_at: "2026-11-12T21:30:00Z" },
      { started_at: "2026-11-13T06:00:00Z", ended_at: null },
    ];
    expect(
      trackedSeconds(
        sessions,
        "2026-11-13",
        "Europe/Moscow",
        Date.parse("2026-11-13T06:20:00Z"),
      ),
    ).toBe(3000);
  });
});
