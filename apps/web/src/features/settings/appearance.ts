import { readStoredValue } from "../../lib/storage";

export const appearancePresets = {
  modern: {
    label: "Dark Modern",
    background: "#1f1f1f",
    sidebar: "#181818",
    text: "#cccccc",
    accent: "#e2c15a",
  },
  charcoal: {
    label: "Charcoal",
    background: "#1c1d1d",
    sidebar: "#222323",
    text: "#e5e5e2",
    accent: "#c4b69e",
  },
  warm: {
    label: "Warm",
    background: "#211f1c",
    sidebar: "#292621",
    text: "#e8e1d6",
    accent: "#c1ae8b",
  },
  slate: {
    label: "Slate",
    background: "#1c2024",
    sidebar: "#24292e",
    text: "#dce1e5",
    accent: "#a9bac2",
  },
};

export type AppearancePreset = keyof typeof appearancePresets;

export type PaletteStyle = "modern" | "comic" | "snow" | "stars";
export type PaletteMode = "dark" | "light";

export const colorTokens = [
  ["background", "Background", "--surface-main"],
  ["sidebar", "Sidebar", "--surface-sidebar"],
  ["rail", "Project rail", "--surface-rail"],
  ["header", "Header", "--surface-header"],
  ["floating", "Panels", "--surface-floating"],
  ["input", "Inputs", "--surface-input"],
  ["hover", "Hover", "--surface-hover"],
  ["selected", "Selected", "--surface-selected"],
  ["projectIcons", "Project icons", "--avatar-background"],
  ["text", "Text", "--text-primary"],
  ["headings", "Headings", "--text-heading"],
  ["textSecondary", "Secondary text", "--text-secondary"],
  ["textMuted", "Muted text", "--text-muted"],
  ["textFaint", "Faint text", "--text-faint"],
  ["border", "Borders", "--border-default"],
  ["borderSubtle", "Dividers", "--border-subtle"],
] as const;

export type ColorToken = (typeof colorTokens)[number][0];
/** Colors stored outside the legacy top-level fields that Android also reads. */
export type ExtraColorToken = Exclude<
  ColorToken,
  "background" | "sidebar" | "text"
>;
export type PaletteColors = Record<ColorToken, string>;

const modernDark: PaletteColors = {
  background: "#1f1f1f",
  sidebar: "#181818",
  rail: "#181818",
  header: "#181818",
  floating: "#222222",
  input: "#313131",
  hover: "#2a2d2e",
  selected: "#37373d",
  text: "#cccccc",
  headings: "#dddddd",
  projectIcons: "#45443f",
  textSecondary: "#b5b5b5",
  textMuted: "#a3a3a3",
  textFaint: "#939393",
  border: "#3c3c3c",
  borderSubtle: "#2b2b2b",
};

export const palettes = {
  modern: {
    label: "Modern",
    halftone: false,
    dark: { accent: "#e2c15a", colors: modernDark },
    light: {
      accent: "#8d6a00",
      colors: {
        background: "#faf9f6",
        sidebar: "#f0efeb",
        rail: "#ebe9e4",
        header: "#f0efeb",
        floating: "#ffffff",
        input: "#eeede9",
        hover: "#e7e5df",
        selected: "#e2dfd7",
        text: "#343331",
        headings: "#222220",
        projectIcons: "#dddad1",
        textSecondary: "#4a4844",
        textMuted: "#64615b",
        textFaint: "#706c64",
        border: "#ccc9c0",
        borderSubtle: "#e0ded6",
      },
    },
  },
  comic: {
    label: "Comic",
    halftone: true,
    dark: { accent: "#e2c15a", colors: modernDark },
    light: {
      accent: "#b33c34",
      colors: {
        background: "#f5e8c9",
        sidebar: "#ead6aa",
        rail: "#e3cc9b",
        header: "#ead6aa",
        floating: "#fff4d9",
        input: "#efddb3",
        hover: "#e3cb94",
        selected: "#dbc28c",
        text: "#302b27",
        headings: "#211e1c",
        projectIcons: "#d6ba7d",
        textSecondary: "#4a3f33",
        textMuted: "#65543e",
        textFaint: "#756246",
        border: "#8e7b57",
        borderSubtle: "#ceba8e",
      },
    },
  },
} as Record<
  PaletteStyle,
  { label: string; halftone: boolean } & Record<
    PaletteMode,
    { accent: string; colors: PaletteColors }
  >
>;

palettes.snow = {
  label: "Snow",
  halftone: false,
  dark: { accent: "#91b6d0", colors: { ...palettes.modern.dark.colors } },
  light: { accent: "#476b87", colors: { ...palettes.modern.light.colors } },
};
palettes.stars = {
  label: "Stars",
  halftone: false,
  dark: { accent: "#b2a3d5", colors: { ...palettes.modern.dark.colors } },
  light: { accent: "#755398", colors: { ...palettes.modern.light.colors } },
};

const statusColors: Record<PaletteMode, Record<string, string>> = {
  dark: {
    "--danger": "#df9d96",
    "--success": "#9fc28a",
    "--danger-surface": "#402c2a",
  },
  light: {
    "--danger": "#a3342c",
    "--success": "#4f7a3a",
    "--danger-surface": "#f6dcd8",
  },
};

/** The palette colors for a style and mode, before any personal edits. */
export function paletteDefaults(style: PaletteStyle, mode: PaletteMode) {
  return palettes[style][mode];
}

export function paletteColors(preset: AppearancePreset) {
  const { background, sidebar, text, accent } = appearancePresets[preset];
  return { background, sidebar, text, accent };
}

export const messageLayouts = {
  minute: {
    label: "Minute markers",
    description:
      "Tight stacks with a small time label at the start of each group.",
  },
  connected: {
    label: "Connected thoughts",
    description: "A quiet vertical line connects notes written together.",
  },
  quiet: {
    label: "Quiet timestamp gutter",
    description: "One timestamp per burst. Hover or focus a note for its time.",
  },
  rows: {
    label: "Compact rows",
    description:
      "Every note has a timestamp on the right; pauses add a divider.",
  },
};

export type MessageLayout = keyof typeof messageLayouts;

export interface AppearanceTheme {
  preset: AppearancePreset;
  style: PaletteStyle;
  mode: PaletteMode;
  colors: Partial<Record<ExtraColorToken, string>>;
  profiles: Partial<
    Record<`${PaletteStyle}-${PaletteMode}`, Partial<PaletteColors>>
  >;
  background: string;
  sidebar: string;
  text: string;
  accent: string;
  textSize: number;
  zoom: number;
  messageLayout: MessageLayout;
  messageGroupMinutes: number;
  density: "compact" | "comfortable" | "spacious";
  font: "system" | "sans" | "serif" | "mono";
  codeFont: "system" | "consolas" | "courier";
  lineHeight: number;
  readingWidth: number;
  reducedMotion: boolean;
  highContrast: boolean;
}

export interface AppearancePreferences extends AppearanceTheme {
  savedThemes: Record<string, AppearanceTheme>;
}

export const defaultAppearance: AppearancePreferences = {
  preset: "modern",
  style: "modern",
  mode: "dark",
  colors: {},
  profiles: {},
  ...paletteColors("modern"),
  textSize: 15,
  zoom: 100,
  messageLayout: "minute",
  messageGroupMinutes: 2,
  density: "comfortable",
  font: "system",
  codeFont: "system",
  lineHeight: 1.6,
  readingWidth: 960,
  reducedMotion: false,
  highContrast: false,
  savedThemes: {},
};

export const APPEARANCE_KEY = "noted.appearance.v1";

export function readAppearance(): AppearancePreferences {
  try {
    const value = JSON.parse(readStoredValue(APPEARANCE_KEY) ?? "null") as
      | (Partial<AppearancePreferences> & { version?: number })
      | null;
    if (!value || typeof value !== "object") return defaultAppearance;
    const result = { ...defaultAppearance };
    for (const key of ["background", "sidebar", "text", "accent"] as const) {
      if (typeof value[key] === "string" && /^#[0-9a-f]{6}$/i.test(value[key]))
        result[key] = value[key];
    }
    if (value.preset && Object.hasOwn(appearancePresets, value.preset))
      result.preset = value.preset;
    if (value.style && Object.hasOwn(palettes, value.style))
      result.style = value.style;
    if (value.mode === "dark" || value.mode === "light")
      result.mode = value.mode;
    if (value.colors && typeof value.colors === "object") {
      const colors: AppearancePreferences["colors"] = {};
      for (const [key] of colorTokens) {
        const color = (value.colors as Record<string, unknown>)[key];
        if (
          key !== "background" &&
          key !== "sidebar" &&
          key !== "text" &&
          typeof color === "string" &&
          /^#[0-9a-f]{6}$/i.test(color)
        )
          colors[key] = color;
      }
      result.colors = colors;
    }
    if (value.profiles && typeof value.profiles === "object") {
      result.profiles = {};
      for (const [key, saved] of Object.entries(value.profiles)) {
        if (
          !/^(modern|comic|snow|stars)-(dark|light)$/.test(key) ||
          !saved ||
          typeof saved !== "object"
        )
          continue;
        result.profiles[key as keyof typeof result.profiles] =
          Object.fromEntries(
            colorTokens
              .filter(
                ([token]) =>
                  typeof saved[token] === "string" &&
                  /^#[0-9a-f]{6}$/i.test(saved[token]!),
              )
              .map(([token]) => [token, saved[token]]),
          );
      }
    }
    if (
      value.version === undefined &&
      value.preset === "charcoal" &&
      (["background", "sidebar", "text", "accent"] as const).every(
        (key) => value[key] === appearancePresets.charcoal[key],
      )
    ) {
      Object.assign(result, paletteColors("modern"), { preset: "modern" });
    }
    if (typeof value.textSize === "number" && Number.isFinite(value.textSize))
      result.textSize = Math.min(20, Math.max(12, value.textSize));
    if (typeof value.zoom === "number" && Number.isFinite(value.zoom))
      result.zoom = Math.min(150, Math.max(75, value.zoom));
    if (
      value.messageLayout &&
      Object.hasOwn(messageLayouts, value.messageLayout)
    )
      result.messageLayout = value.messageLayout;
    if (
      typeof value.messageGroupMinutes === "number" &&
      Number.isInteger(value.messageGroupMinutes)
    )
      result.messageGroupMinutes = Math.min(
        30,
        Math.max(1, value.messageGroupMinutes),
      );
    if (["compact", "comfortable", "spacious"].includes(value.density ?? ""))
      result.density = value.density!;
    if (["system", "sans", "serif", "mono"].includes(value.font ?? ""))
      result.font = value.font!;
    if (["system", "consolas", "courier"].includes(value.codeFont ?? ""))
      result.codeFont = value.codeFont!;
    if (typeof value.lineHeight === "number")
      result.lineHeight = Math.min(2, Math.max(1.2, value.lineHeight));
    if (typeof value.readingWidth === "number")
      result.readingWidth = Math.min(1600, Math.max(480, value.readingWidth));
    result.reducedMotion = value.reducedMotion === true;
    result.highContrast = value.highContrast === true;
    if (value.savedThemes && typeof value.savedThemes === "object")
      result.savedThemes = value.savedThemes;
    return result;
  } catch {
    return defaultAppearance;
  }
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map(
    (start) => parseInt(color.slice(start, start + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

/**
 * Every color the interface uses. Background, sidebar and text live in the
 * legacy fields so the phone app keeps working; the rest come from personal
 * edits or the palette. When an older client changed the legacy fields without
 * saving any other colors, the remaining surfaces are mixed from them as before
 * so its presets still look coherent.
 */
export function resolveColors(
  preferences: AppearancePreferences,
): PaletteColors {
  const palette = palettes[preferences.style][preferences.mode].colors;
  const { background, sidebar, text } = preferences;
  const legacy =
    !Object.keys(preferences.colors).length &&
    (background !== palette.background ||
      sidebar !== palette.sidebar ||
      text !== palette.text);
  const mix = (first: string, amount: number, second: string) => {
    const other = second === "black" ? "#000000" : second;
    return `#${[1, 3, 5]
      .map((start) =>
        Math.round(
          (parseInt(first.slice(start, start + 2), 16) * amount) / 100 +
            (parseInt(other.slice(start, start + 2), 16) * (100 - amount)) /
              100,
        )
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };
  const base: PaletteColors = legacy
    ? {
        background,
        sidebar,
        text,
        headings: text,
        projectIcons: mix(sidebar, 85, preferences.accent),
        rail: mix(background, 72, "black"),
        header: mix(background, 65, sidebar),
        floating: mix(sidebar, 96, text),
        input: mix(background, 93, text),
        hover: mix(sidebar, 94, text),
        selected: mix(sidebar, 89, text),
        textSecondary: mix(text, 77, background),
        textMuted: mix(text, 66, background),
        textFaint: mix(text, 56, background),
        border: mix(background, 80, text),
        borderSubtle: mix(background, 90, text),
      }
    : { ...palette, background, sidebar, text };
  return { ...base, ...preferences.colors };
}

export function applyAppearance(preferences: AppearancePreferences) {
  const { accent, mode } = preferences;
  const colors = resolveColors(preferences);
  const mix = (first: string, amount: number, second: string) =>
    `color-mix(in srgb, ${first} ${amount}%, ${second})`;
  const tokens: Record<string, string> = {
    ...Object.fromEntries(
      colorTokens.map(([key, , variable]) => [variable, colors[key]]),
    ),
    ...statusColors[mode],
    "--surface-code": mix(
      colors.background,
      mode === "dark" ? 81 : 94,
      "black",
    ),
    "--accent": accent,
    "--accent-hover": mix(accent, 86, colors.text),
    "--accent-text": luminance(accent) > 0.35 ? "#201e1a" : "#f4f4ef",
    "--link": mix(accent, 88, colors.text),
    "--avatar-background": colors.projectIcons,
    "--avatar-text": colors.text,
    "--text-scale": String(preferences.textSize / 15),
    "--ui-zoom": String(preferences.zoom / 100),
    "--app-font": {
      system: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
      sans: "Arial, Helvetica, sans-serif",
      serif: 'Georgia, "Times New Roman", serif',
      mono: "Consolas, monospace",
    }[preferences.font ?? "system"],
    "--code-font": {
      system: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      consolas: "Consolas, monospace",
      courier: '"Courier New", monospace',
    }[preferences.codeFont ?? "system"],
    "--message-line-height": String(preferences.lineHeight ?? 1.6),
    "--reading-width": `${preferences.readingWidth ?? 960}px`,
    "--note-padding": `${{ compact: 4, comfortable: 8, spacious: 12 }[preferences.density ?? "comfortable"]}px`,
  };
  if (preferences.highContrast) {
    tokens["--border-default"] = colors.textSecondary;
    tokens["--border-subtle"] = colors.textMuted;
  }
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens))
    root.style.setProperty(name, value);
  root.style.colorScheme = mode;
  root.dataset.backgroundProfile = preferences.style;
  root.dataset.appearanceMode = mode;
  root.dataset.reducedMotion = String(preferences.reducedMotion ?? false);
  root.dataset.highContrast = String(preferences.highContrast ?? false);
  root.dataset.halftone = String(palettes[preferences.style].halftone);
  root.style.zoom = String(preferences.zoom / 100);
}
