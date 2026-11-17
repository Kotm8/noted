import { describe, expect, it } from "vitest";
import { minor, shiftMonth } from "./money";

describe("Finance amounts", () => {
  it("converts decimal input into exact integer minor units", () => {
    expect(minor("0.29")).toBe(29);
    expect(minor("1234.5")).toBe(123450);
    expect(minor("-18.01")).toBe(-1801);
    expect(() => minor("1.005")).toThrow();
    expect(() => minor("1e5")).toThrow();
  });
  it("changes months across year boundaries", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });
});
