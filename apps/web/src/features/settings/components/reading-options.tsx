import { useAppearance } from "../appearance-context";
import type { AppearanceTheme } from "../appearance";

export function ReadingOptions() {
  const { preferences: p, update } = useAppearance();
  const choices = <K extends keyof AppearanceTheme>(
    key: K,
    label: string,
    options: readonly string[],
  ) => (
    <label className="appearance-setting">
      {label}
      <select
        aria-label={label}
        value={String(p[key])}
        onChange={(event) => update({ [key]: event.target.value })}
      >
        {options.map((value) => (
          <option value={value} key={value}>
            {value[0].toUpperCase() + value.slice(1)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="settings-section">
      <h3>Reading</h3>
      {choices("density", "Density", ["compact", "comfortable", "spacious"])}
      {choices("font", "Font", ["system", "sans", "serif", "mono"])}
      {choices("codeFont", "Code font", ["system", "consolas", "courier"])}
      <label className="range-control">
        <span>
          Line height<output>{p.lineHeight.toFixed(1)}</output>
        </span>
        <input
          aria-label="Line height"
          type="range"
          min={1.2}
          max={2}
          step={0.1}
          value={p.lineHeight}
          onChange={(e) => update({ lineHeight: Number(e.target.value) })}
        />
      </label>
      <label className="range-control">
        <span>
          Reading width<output>{p.readingWidth} px</output>
        </span>
        <input
          aria-label="Reading width"
          type="range"
          min={480}
          max={1600}
          step={40}
          value={p.readingWidth}
          onChange={(e) => update({ readingWidth: Number(e.target.value) })}
        />
      </label>
      <label className="appearance-setting appearance-toggle">
        <span>Reduce motion</span>
        <input
          type="checkbox"
          checked={p.reducedMotion}
          onChange={(e) => update({ reducedMotion: e.target.checked })}
        />
      </label>
      <label className="appearance-setting appearance-toggle">
        <span>Stronger borders and focus</span>
        <input
          type="checkbox"
          checked={p.highContrast}
          onChange={(e) => update({ highContrast: e.target.checked })}
        />
      </label>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          update({
            density: "comfortable",
            font: "system",
            codeFont: "system",
            lineHeight: 1.6,
            readingWidth: 960,
            reducedMotion: false,
            highContrast: false,
          })
        }
      >
        Reset reading settings
      </button>
    </section>
  );
}
