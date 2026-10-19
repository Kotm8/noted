import { describe, expect, it } from "vitest";
import { addDays, wallTime, weekDays, zonedParts } from "./dates";

describe("schedule timezone boundaries", () => {
  it("finds Monday and preserves calendar days over month and year boundaries", () => {
    expect(weekDays("2026-10-18")).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("converts wall time using the selected timezone rather than the device timezone", () => {
    expect(wallTime("2026-10-18", 540, "Europe/Moscow")).toBe(
      "2026-10-18T06:00:00.000Z",
    );
    expect(zonedParts("2026-10-18T23:00:00Z", "Europe/Moscow")).toEqual({
      date: "2026-10-19",
      minute: 120,
    });
    expect(wallTime("2026-10-18", 1440, "Europe/Moscow")).toBe(
      "2026-10-18T21:00:00.000Z",
    );
  });
  it("uses 23 and 25 hour days at daylight-saving transitions and rejects missing wall times", () => {
    const dayLength = (date: string) =>
      (Date.parse(wallTime(date, 1440, "Europe/Berlin")) -
        Date.parse(wallTime(date, 0, "Europe/Berlin"))) /
      3600000;
    expect(dayLength("2026-03-29")).toBe(23);
    expect(dayLength("2026-10-25")).toBe(25);
    expect(() => wallTime("2026-03-29", 150, "Europe/Berlin")).toThrow(
      "does not exist",
    );
  });
});
