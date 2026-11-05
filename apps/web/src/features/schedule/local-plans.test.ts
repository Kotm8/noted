import { describe, expect, it } from "vitest";
import {
  applyLocalWrite,
  localOccurrence,
  type ScheduleWrite,
} from "./local-plans";
import type { ScheduleBoard, SchedulePlan } from "./types";

const plan: SchedulePlan = {
  id: "local-plan",
  revision: 0,
  activity_id: "reading",
  title: "Read",
  date: "2026-11-02",
  timezone: "Europe/Moscow",
  start_minute: 600,
  end_minute: 660,
  frequency: "weekly",
  weekdays: [0, 4],
  repeat_until: null,
};
const empty: ScheduleBoard = { plans: [], sessions: [], reminders: [] };
const write: ScheduleWrite = {
  id: "change",
  owner: "owner",
  kind: "create",
  plan,
  scope: "series",
  label: "adding",
};

describe("local calendar changes", () => {
  it("previews recurrence on custom weekdays, including before the server assigns a revision", () => {
    const board = applyLocalWrite(empty, write, "2026-11-02", "2026-11-08");
    expect(board.plans.map((item) => item.date)).toEqual([
      "2026-11-02",
      "2026-11-06",
    ]);
    expect(board.plans[0].start_at).toBe("2026-11-02T07:00:00.000Z");
    expect(board.plans[0].revision).toBe(0);
  });
  it("moves only the chosen occurrence and preserves its identity", () => {
    const board = applyLocalWrite(empty, write, "2026-11-02", "2026-11-08");
    const original = board.plans[0];
    const updated = applyLocalWrite(
      board,
      {
        ...write,
        kind: "update",
        scope: "occurrence",
        original,
        plan: { ...plan, date: "2026-11-03", title: "Moved" },
      },
      "2026-11-02",
      "2026-11-08",
    );
    expect(updated.plans).toHaveLength(2);
    expect(updated.plans.find((item) => item.title === "Moved")).toMatchObject({
      date: "2026-11-03",
      occurrence_date: "2026-11-02",
      is_override: true,
    });
  });
  it("removes a whole series or one occurrence without changing sessions", () => {
    const board = applyLocalWrite(empty, write, "2026-11-02", "2026-11-08");
    expect(
      applyLocalWrite(
        board,
        { ...write, kind: "delete" },
        "2026-11-02",
        "2026-11-08",
      ).plans,
    ).toHaveLength(0);
    expect(
      applyLocalWrite(
        board,
        {
          ...write,
          kind: "delete",
          scope: "occurrence",
          original: board.plans[0],
        },
        "2026-11-02",
        "2026-11-08",
      ).plans,
    ).toHaveLength(1);
    expect(board.sessions).toBe(empty.sessions);
  });
  it("skips missing monthly dates and daylight-saving gaps", () => {
    const monthly = applyLocalWrite(
      empty,
      { ...write, plan: { ...plan, date: "2027-01-31", frequency: "monthly" } },
      "2027-02-01",
      "2027-02-28",
    );
    expect(monthly.plans.map((item) => item.date)).not.toContain("2027-02-28");
    expect(
      localOccurrence(
        {
          ...plan,
          timezone: "Europe/Berlin",
          start_minute: 150,
          end_minute: 210,
        },
        "2027-03-28",
      ),
    ).toBeNull();
  });
});
