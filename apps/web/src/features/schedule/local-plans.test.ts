import { describe, expect, it } from "vitest";
import { patchScheduleBoard, type ScheduleWrite } from "./local-plans";
import type { ScheduleBoard } from "./types";

const board: ScheduleBoard = { plans: [], sessions: [], reminders: [] };
const write: ScheduleWrite = {
  id: "write",
  owner: "owner",
  kind: "create",
  scope: "series",
  label: "adding the plan",
  plan: {
    id: "plan",
    revision: 1,
    activity_id: "activity",
    title: "Work",
    date: "2026-11-24",
    timezone: "Europe/Moscow",
    start_minute: 30,
    end_minute: 60,
    frequency: "none",
    weekdays: [],
    repeat_until: null,
  },
};

describe("patchScheduleBoard", () => {
  it("leaves other queries in the schedule cache intact after a save", () => {
    expect(
      patchScheduleBoard(board, ["schedule", "templates", "owner"], write),
    ).toBe(board);
    expect(
      patchScheduleBoard(
        board,
        ["schedule", "ai-context", "today", "tomorrow", "UTC"],
        write,
      ),
    ).toBe(board);
  });

  it("uses the real interval when the board begins on the previous UTC date", () => {
    const updated = patchScheduleBoard(
      board,
      ["schedule", "2026-11-23T21:00:00Z", "2026-11-24T21:00:00Z"],
      write,
    );
    expect(updated?.plans).toMatchObject([
      { id: "plan", occurrence_date: "2026-11-24" },
    ]);
  });
});
