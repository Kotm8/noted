import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { paletteDefaults, type ColorToken } from "../appearance";
import { useAppearance } from "../appearance-context";
import {
  accents,
  colorSwatches,
  editColor,
  editableColors,
  hexColors,
} from "../appearance-colors";

function Swatches({
  values,
  current,
  choose,
  label,
}: {
  values: readonly (readonly [string, string])[];
  current: string;
  choose: (value: string) => void;
  label: string;
}) {
  return (
    <div className="appearance-swatches" role="group" aria-label={label}>
      {values.map(([name, color]) => (
        <button
          key={name}
          className="appearance-swatch"
          aria-label={`${name} ${label.toLowerCase()}`}
          title={name}
          aria-pressed={color.toLowerCase() === current.toLowerCase()}
          onClick={() => choose(color)}
          style={{ "--swatch": color } as CSSProperties}
        >
          <span>
            {color.toLowerCase() === current.toLowerCase() && (
              <Check size={14} />
            )}
          </span>
          <span>{name}</span>
        </button>
      ))}
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="appearance-color-input">
      <span>{value.toUpperCase()}</span>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function AppearanceColorEditor() {
  const { preferences: p, update } = useAppearance();
  const [token, setToken] = useState<ColorToken>("background");
  const colors = hexColors(p);
  const label = editableColors.find(([key]) => key === token)![1];
  const choose = (value: string) => update(editColor(p, token, value));
  return (
    <>
      <section className="appearance-color-section">
        <div className="appearance-control-heading">
          <h3>Colors</h3>
          <ColorInput
            label={`${label} color`}
            value={colors[token]}
            onChange={choose}
          />
        </div>
        <div
          className="appearance-token-list"
          role="group"
          aria-label="Color to edit"
        >
          {editableColors.map(([key, name]) => (
            <button
              key={key}
              aria-pressed={key === token}
              onClick={() => setToken(key)}
            >
              <i style={{ background: colors[key] }} />
              {name}
            </button>
          ))}
        </div>
        <Swatches
          label={label}
          values={colorSwatches(paletteDefaults(p.style, p.mode).colors[token])}
          current={colors[token]}
          choose={choose}
        />
      </section>
      <section className="appearance-color-section">
        <div className="appearance-control-heading">
          <h3>Accent color</h3>
          <ColorInput
            label="Accent color"
            value={p.accent}
            onChange={(accent) => update({ accent })}
          />
        </div>
        <Swatches
          label="Accent"
          values={accents}
          current={p.accent}
          choose={(accent) => update({ accent })}
        />
      </section>
    </>
  );
}
