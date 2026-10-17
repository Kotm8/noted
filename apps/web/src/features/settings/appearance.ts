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

export function paletteColors(preset: AppearancePreset) {
  const { background, sidebar, text, accent } = appearancePresets[preset];
  return { background, sidebar, text, accent };
}

export const messageLayouts = {
  minute: {
    label: "Minute markers",
    description: "Tight stacks with a small label when the minute changes.",
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
    description: "Every note has a timestamp on the right; pauses add a divider.",
  },
};

export type MessageLayout = keyof typeof messageLayouts;

export interface AppearancePreferences {
  preset: AppearancePreset;
  background: string;
  sidebar: string;
  text: string;
  accent: string;
  textSize: number;
  zoom: number;
  messageLayout: MessageLayout;
}

export const defaultAppearance: AppearancePreferences = {
  preset: "modern",
  ...paletteColors("modern"),
  textSize: 15,
  zoom: 100,
  messageLayout: "minute",
};

export const APPEARANCE_KEY = "noted.appearance.v1";

export function readAppearance(): AppearancePreferences {
  try {
    const value = JSON.parse(
      readStoredValue(APPEARANCE_KEY) ?? "null",
    ) as (Partial<AppearancePreferences> & { version?: number }) | null;
    if (!value || typeof value !== "object") return defaultAppearance;
    const result = { ...defaultAppearance };
    for (const key of ["background", "sidebar", "text", "accent"] as const) {
      if (typeof value[key] === "string" && /^#[0-9a-f]{6}$/i.test(value[key]))
        result[key] = value[key];
    }
    if (value.preset && Object.hasOwn(appearancePresets, value.preset))
      result.preset = value.preset;
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
    if (value.messageLayout && Object.hasOwn(messageLayouts, value.messageLayout))
      result.messageLayout = value.messageLayout;
    return result;
  } catch {
    return defaultAppearance;
  }
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function applyAppearance(preferences: AppearancePreferences) {
  const { background, sidebar, text, accent } = preferences;
  const mix = (first: string, amount: number, second: string) =>
    `color-mix(in srgb, ${first} ${amount}%, ${second})`;
  const tokens: Record<string, string> = {
    "--surface-main": background,
    "--surface-sidebar": sidebar,
    "--surface-header": mix(background, 65, sidebar),
    "--surface-rail": mix(background, 72, "black"),
    "--surface-input": mix(background, 93, text),
    "--surface-floating": mix(sidebar, 96, text),
    "--surface-hover": mix(sidebar, 94, text),
    "--surface-selected": mix(sidebar, 89, text),
    "--surface-code": mix(background, 81, "black"),
    "--border-subtle": mix(background, 90, text),
    "--border-default": mix(background, 80, text),
    "--text-primary": text,
    "--text-secondary": mix(text, 77, background),
    "--text-muted": mix(text, 62, background),
    "--text-faint": mix(text, 49, background),
    "--accent": accent,
    "--accent-hover": mix(accent, 86, text),
    "--accent-text": luminance(accent) > 0.35 ? "#201e1a" : "#f4f4ef",
    "--link": mix(accent, 88, text),
    "--avatar-background": mix(sidebar, 85, accent),
    "--avatar-text": text,
    "--text-scale": String(preferences.textSize / 15),
    "--ui-zoom": String(preferences.zoom / 100),
  };

  if (
    (["background", "sidebar", "text"] as const).every(
      (key) => preferences[key] === appearancePresets.modern[key],
    )
  ) {
    Object.assign(tokens, {
      "--surface-header": "#181818",
      "--surface-rail": "#181818",
      "--surface-input": "#313131",
      "--surface-floating": "#222222",
      "--surface-hover": "#2a2d2e",
      "--surface-selected": "#37373d",
      "--surface-code": "#181818",
      "--border-subtle": "#2b2b2b",
      "--border-default": "#3c3c3c",
      "--text-secondary": "#b5b5b5",
      "--text-muted": "#9d9d9d",
      "--text-faint": "#868686",
    });
  }

  for (const [name, value] of Object.entries(tokens))
    document.documentElement.style.setProperty(name, value);
  document.documentElement.style.zoom = String(preferences.zoom / 100);
}
