import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { palettes, type PaletteMode, type PaletteStyle } from "../appearance";
import { useAppearance } from "../appearance-context";
import { selectProfile } from "../appearance-colors";

function Thumbnail({ style }: { style: PaletteStyle }) {
  return (
    <svg
      viewBox="0 0 150 44"
      aria-hidden="true"
      className={`profile-pattern profile-pattern-${style}`}
    >
      {style === "comic" &&
        Array.from({ length: 60 }, (_, index) => {
          const column = index % 12,
            row = Math.floor(index / 12);
          const radius =
            2.5 * (0.5 + 0.5 * Math.sin(column * 0.56 + row * 0.4));
          return radius < 0.35 ? null : (
            <circle
              key={index}
              cx={column * 13 + 6 + (row % 2) * 6.5}
              cy={row * 8 + 6}
              r={radius}
            />
          );
        })}
      {style === "snow" &&
        [
          [15, 12, 1.7],
          [38, 29, 2.1],
          [65, 8, 1.2],
          [83, 33, 1.6],
          [110, 18, 2],
          [138, 34, 1.3],
        ].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} />)}
      {style === "stars" && (
        <>
          <path d="m27 9 1.8 5.2L34 16l-5.2 1.8L27 23l-1.8-5.2L20 16l5.2-1.8zM102 21l1.3 3.7L107 26l-3.7 1.3L102 31l-1.3-3.7L97 26l3.7-1.3z" />
          <circle cx="55" cy="31" r="1" />
          <circle cx="78" cy="9" r="1.2" />
          <circle cx="134" cy="15" r="1" />
        </>
      )}
    </svg>
  );
}

export function ProfilePicker() {
  const { preferences: p, update } = useAppearance();
  return (
    <fieldset className="appearance-profiles">
      <legend className="visually-hidden">Palette</legend>
      <div className="appearance-control-heading">
        <h3>Palette</h3>
        <div className="appearance-mode" role="group" aria-label="Mode">
          {(["dark", "light"] as PaletteMode[]).map((mode) => (
            <button
              key={mode}
              aria-pressed={p.mode === mode}
              onClick={() => update(selectProfile(p, p.style, mode))}
            >
              {mode === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-profile-grid">
        {(Object.keys(palettes) as PaletteStyle[]).map((style) => {
          const defaults = palettes[style][p.mode];
          const colors = {
            ...defaults.colors,
            ...p.profiles[`${style}-${p.mode}`],
          };
          return (
            <button
              key={style}
              className="appearance-profile"
              aria-pressed={p.style === style}
              onClick={() => update(selectProfile(p, style, p.mode))}
              style={
                {
                  "--profile-main": colors.background,
                  "--profile-sidebar": colors.sidebar,
                  "--profile-accent":
                    p.style === style ? p.accent : defaults.accent,
                } as CSSProperties
              }
            >
              <span className="appearance-profile-thumbnail">
                <Thumbnail style={style} />
                {style === "modern" && <i />}
              </span>
              <span>
                {palettes[style].label}
                {p.style === style && <Check size={14} />}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
