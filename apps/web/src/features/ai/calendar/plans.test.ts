import { describe, expect, it } from "vitest";
import { findGap, previewOccurrence, proposalConflicts } from "./plans";
import type { CalendarScope, PreviewPlan } from "./types";

const scope: CalendarScope = {
  start: "2090-06-12",
  end: "2090-06-12",
  timezone: "Europe/Moscow",
  start_minute: 480,
  end_minute: 1200,
};
const plan: PreviewPlan = {
  id: "proposal-one",
  activity_id: "reading",
  title: "Read",
  date: scope.start,
  start_minute: 600,
  end_minute: 660,
  selected: true,
  notifications_enabled: true,
  notification_minutes: null,
};
const active = new Set(["reading"]);

describe("calendar proposals", () => {
  it("detects cross-timezone overlaps against actual instants", () => {
    const existing = {
      ...previewOccurrence(plan, scope.timezone)!,
      timezone: "UTC",
    };
    expect(
      proposalConflicts([plan], [existing], scope, active).get(plan.id),
    ).toBe("Overlaps Read.");
    const touching = { ...plan, start_minute: 660, end_minute: 720 };
    expect(proposalConflicts([touching], [existing], scope, active).size).toBe(
      0,
    );
  });
  it("ignores excluded suggestions as blockers and finds a free gap", () => {
    const excluded = { ...plan, id: "other", selected: false };
    expect(
      proposalConflicts([plan, excluded], [], scope, active).has(plan.id),
    ).toBe(false);
    const existing = previewOccurrence(
      { ...plan, start_minute: 480, end_minute: 600 },
      scope.timezone,
    )!;
    const next = findGap(
      { ...plan, start_minute: 480, end_minute: 540 },
      [plan],
      [existing],
      scope,
    );
    expect(next?.start_minute).toBe(600);
    expect(next?.end_minute).toBe(660);
  });
  it("does not crash the calendar for a daylight-saving gap", () => {
    const missing = {
      ...plan,
      date: "2090-03-26",
      start_minute: 150,
      end_minute: 210,
    };
    const berlin = {
      ...scope,
      start: missing.date,
      end: missing.date,
      timezone: "Europe/Berlin",
      start_minute: 0,
    };
    expect(previewOccurrence(missing, berlin.timezone)).toBeNull();
    expect(
      proposalConflicts([missing], [], berlin, active, 0).get(plan.id),
    ).toContain("does not exist");
  });
  it("marks archived activities, out-of-range dates and past starts", () => {
    expect(
      proposalConflicts([plan], [], scope, new Set()).get(plan.id),
    ).toContain("active activity");
    expect(
      proposalConflicts(
        [{ ...plan, date: "2090-06-13" }],
        [],
        scope,
        active,
      ).get(plan.id),
    ).toContain("selected dates");
    expect(
      proposalConflicts(
        [plan],
        [],
        scope,
        active,
        Date.parse("2091-01-01"),
      ).get(plan.id),
    ).toContain("has passed");
  });
});
