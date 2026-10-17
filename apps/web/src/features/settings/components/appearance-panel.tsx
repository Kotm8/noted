import { Button } from "../../../components/ui/button";
import {
  appearancePresets,
  contrastRatio,
  paletteColors,
  type AppearancePreset,
} from "../appearance";
import { useAppearance } from "../appearance-context";
import { Notice } from "../../../components/ui/notice";
import { MessageLayoutPicker } from "./message-layout-picker";

export function AppearancePanel() {
  const { preferences, update, reset, isSaving, saveError } = useAppearance();
  const contrast = contrastRatio(preferences.text, preferences.background);

  function choosePreset(preset: AppearancePreset) {
    update({ preset, ...paletteColors(preset) });
  }

  return (
    <section className="settings-panel">
      <h2>Appearance</h2>
      <p>Saved to your account and shared across devices. Changes apply immediately.</p>
      <p className="appearance-save-status" role="status">
        {isSaving ? "Saving appearance..." : ""}
      </p>
      {saveError && (
        <Notice tone="error">Could not save appearance: {saveError}</Notice>
      )}

      <MessageLayoutPicker />

      <fieldset className="settings-fieldset">
        <legend>Palette</legend>
        <div className="palette-options">
          {(Object.keys(appearancePresets) as AppearancePreset[]).map((preset) => (
            <button
              key={preset}
              className="palette-option"
              aria-pressed={
                preferences.preset === preset &&
                (["background", "sidebar", "text", "accent"] as const).every(
                  (key) => preferences[key] === appearancePresets[preset][key],
                )
              }
              onClick={() => choosePreset(preset)}
            >
              <span
                className="palette-swatch"
                style={{
                  background: appearancePresets[preset].background,
                  borderColor: appearancePresets[preset].accent,
                }}
              />
              {appearancePresets[preset].label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>Colors</legend>
        <div className="color-controls">
          {(
            [
              ["background", "Chat background"],
              ["sidebar", "Sidebar background"],
              ["text", "Text color"],
              ["accent", "Accent color"],
            ] as const
          ).map(([key, label]) => (
            <label className="color-control" key={key}>
              <span>{label}</span>
              <input
                aria-label={label}
                type="color"
                value={preferences[key]}
                onChange={(event) => update({ [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        {contrast < 4.5 && (
          <p className="settings-hint" role="status">
            Text contrast is low ({contrast.toFixed(1)}:1). A lighter text color or darker
            background will be easier to read.
          </p>
        )}
      </fieldset>

      <label className="range-control">
        <span>
          Text size <output>{preferences.textSize} px</output>
        </span>
        <input
          aria-label="Text size"
          type="range"
          min={12}
          max={20}
          step={1}
          value={preferences.textSize}
          onChange={(event) => update({ textSize: Number(event.target.value) })}
        />
      </label>
      <label className="range-control">
        <span>
          Interface zoom <output>{preferences.zoom}%</output>
        </span>
        <input
          aria-label="Interface zoom"
          type="range"
          min={75}
          max={150}
          step={5}
          value={preferences.zoom}
          onChange={(event) => update({ zoom: Number(event.target.value) })}
        />
      </label>
      <Button variant="secondary" onClick={reset}>
        Reset appearance
      </Button>
    </section>
  );
}
