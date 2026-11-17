import { describe, expect, it } from "vitest";
import { defaultAppearance } from "./appearance";
import {
  editColor,
  exportColors,
  importColors,
  selectProfile,
} from "./appearance-colors";

describe("account color profiles", () => {
  it("keeps edits separate across profiles and modes", () => {
    const edited = {
      ...defaultAppearance,
      ...editColor(defaultAppearance, "sidebar", "#123456"),
    };
    const snow = { ...edited, ...selectProfile(edited, "snow", "light") };
    expect(snow.sidebar).not.toBe("#123456");
    expect(snow.accent).toBe("#476b87");
    const returned = { ...snow, ...selectProfile(snow, "modern", "dark") };
    expect(returned.sidebar).toBe("#123456");
    expect(returned.colors.rail).toBe("#123456");
    expect(returned.colors.header).toBe("#123456");
  });

  it("round trips exported colors without changing message preferences", () => {
    const edited = {
      ...defaultAppearance,
      ...editColor(defaultAppearance, "headings", "#abcdef"),
      messageGroupMinutes: 8,
    };
    const imported = {
      ...defaultAppearance,
      ...importColors(exportColors(edited), defaultAppearance),
    };
    expect(imported.colors.headings).toBe("#abcdef");
    expect(imported.messageGroupMinutes).toBe(2);
    expect(exportColors(imported)).toBe(exportColors(edited));
  });

  it("rejects a malformed file as a whole", () => {
    const csv = exportColors(defaultAppearance);
    for (const invalid of [
      csv.replace("#cccccc", "red"),
      `${csv}\naccent,#ffffff`,
      csv.replace("palette,modern", "palette,unknown"),
      `${csv}\npassword,secret`,
    ]) {
      expect(() => importColors(invalid, defaultAppearance)).toThrow();
    }
  });
});
