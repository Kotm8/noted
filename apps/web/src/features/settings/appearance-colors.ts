import {
  colorTokens,
  paletteDefaults,
  palettes,
  resolveColors,
  type AppearancePreferences,
  type ColorToken,
  type PaletteColors,
  type PaletteMode,
  type PaletteStyle,
} from "./appearance";

export const editableColors = colorTokens.filter(
  ([key]) => !["rail", "header", "textMuted"].includes(key),
);

export const accents = [
  ["Golden", "#e2c15a"],
  ["Amber", "#dbad68"],
  ["Apricot", "#dfa883"],
  ["Coral", "#d99187"],
  ["Rose", "#ce98af"],
  ["Mauve", "#ba9dbe"],
  ["Lavender", "#b2a3d5"],
  ["Periwinkle", "#9caed9"],
  ["Sky", "#91b6d0"],
  ["Sea glass", "#88bdb8"],
  ["Sage", "#a2b891"],
  ["Sand", "#c4b69e"],
  ["Saffron", "#f0c541"],
  ["Tangerine", "#ed974c"],
  ["Raspberry", "#ef739a"],
  ["Violet", "#b18aee"],
  ["Azure", "#65a4ef"],
  ["Emerald", "#54bf9c"],
] as const;

export function colorChanges(colors: PaletteColors) {
  const { background, sidebar, text, ...extra } = colors;
  return { background, sidebar, text, colors: extra };
}

export function selectProfile(
  preferences: AppearancePreferences,
  style: PaletteStyle,
  mode: PaletteMode,
): Partial<AppearancePreferences> {
  const profiles = {
    ...preferences.profiles,
    [`${preferences.style}-${preferences.mode}`]: hexColors(preferences),
  };
  const defaults = paletteDefaults(style, mode);
  return {
    preset: "modern",
    style,
    mode,
    profiles,
    accent: defaults.accent,
    ...colorChanges({ ...defaults.colors, ...profiles[`${style}-${mode}`] }),
  };
}

export function hexColors(preferences: AppearancePreferences): PaletteColors {
  const resolved = resolveColors(preferences);
  const defaults = paletteDefaults(preferences.style, preferences.mode).colors;
  return Object.fromEntries(
    colorTokens.map(([key]) => [
      key,
      /^#[0-9a-f]{6}$/i.test(resolved[key]) ? resolved[key] : defaults[key],
    ]),
  ) as PaletteColors;
}

export function editColor(
  preferences: AppearancePreferences,
  key: ColorToken,
  value: string,
): Partial<AppearancePreferences> {
  const colors = { ...hexColors(preferences), [key]: value };
  if (key === "sidebar") {
    colors.rail = value;
    colors.header = value;
  }
  if (key === "textSecondary") colors.textMuted = value;
  return {
    ...colorChanges(colors),
    profiles: {
      ...preferences.profiles,
      [`${preferences.style}-${preferences.mode}`]: colors,
    },
  };
}

const csvKey = (label: string) => label.toLowerCase().replaceAll(" ", "_");

export function exportColors(preferences: AppearancePreferences) {
  const colors = hexColors(preferences);
  return [
    "setting,value",
    `palette,${preferences.style}`,
    `mode,${preferences.mode}`,
    `accent,${preferences.accent}`,
    ...editableColors.map(([key, label]) => `${csvKey(label)},${colors[key]}`),
  ].join("\r\n");
}

export function importColors(
  csv: string,
  preferences: AppearancePreferences,
): Partial<AppearancePreferences> {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (lines.shift()?.trim() !== "setting,value")
    throw new Error("Expected a Noted colors CSV with a setting,value header.");
  const values = new Map<string, string>();
  const allowed = new Set([
    "palette",
    "mode",
    "accent",
    ...editableColors.map(([, label]) => csvKey(label)),
  ]);
  for (const line of lines) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 2 || !allowed.has(cells[0]) || values.has(cells[0]))
      throw new Error(
        "The colors file contains an unknown or repeated setting.",
      );
    values.set(cells[0], cells[1]);
  }
  const style = values.get("palette") as PaletteStyle;
  const mode = values.get("mode") as PaletteMode;
  const accent = values.get("accent");
  if (
    !Object.hasOwn(palettes, style) ||
    !["dark", "light"].includes(mode) ||
    !accent ||
    !/^#[0-9a-f]{6}$/i.test(accent)
  )
    throw new Error("Check the palette, mode and accent in the colors file.");
  const colors = { ...paletteDefaults(style, mode).colors };
  for (const [key, label] of editableColors) {
    const value = values.get(csvKey(label));
    if (value === undefined) continue;
    if (!/^#[0-9a-f]{6}$/i.test(value))
      throw new Error(`${label} needs a six-digit hex color.`);
    colors[key] = value;
  }
  colors.rail = colors.sidebar;
  colors.header = colors.sidebar;
  colors.textMuted = colors.textSecondary;
  return {
    ...selectProfile(preferences, style, mode),
    accent,
    ...colorChanges(colors),
    profiles: {
      ...preferences.profiles,
      [`${preferences.style}-${preferences.mode}`]: hexColors(preferences),
      [`${style}-${mode}`]: colors,
    },
  };
}

const linear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const srgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function colorSwatches(hex: string): [string, string][] {
  const [r, g, b] = [1, 3, 5].map((start) =>
    linear(parseInt(hex.slice(start, start + 2), 16) / 255),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const tints: [string, number, number][] = [
    ["Warm", 70, 0.012],
    ["Sand", 85, 0.03],
    ["Olive", 115, 0.03],
    ["Forest", 155, 0.035],
    ["Teal", 195, 0.03],
    ["Slate", 240, 0.025],
    ["Navy", 262, 0.04],
    ["Indigo", 285, 0.04],
    ["Plum", 330, 0.035],
    ["Rose", 10, 0.035],
    ["Espresso", 50, 0.03],
  ];
  return [
    ["Default", hex],
    ...tints.map(([name, hue, chroma]): [string, string] => {
      const a = chroma * Math.cos((hue * Math.PI) / 180);
      const b = chroma * Math.sin((hue * Math.PI) / 180);
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        name,
        `#${[
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ]
          .map((v) =>
            Math.round(Math.min(1, Math.max(0, srgb(v))) * 255)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
      ];
    }),
  ];
}
