import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { useAppearance } from "../appearance-context";
import {
  contrastRatio,
  messageLayouts,
  type MessageLayout,
} from "../appearance";
import { exportColors, importColors } from "../appearance-colors";
import { LegacyAppearancePanel } from "./legacy-appearance-panel";
import { ProfilePicker } from "./profile-picker";
import { AppearanceColorEditor } from "./appearance-color-editor";
import { AppearanceSample } from "./appearance-sample";
import { ReadingOptions } from "./reading-options";
import { SavedThemes } from "./saved-themes";
import "../appearance-editor.css";

export function AppearancePanel({ spacious = false }: { spacious?: boolean }) {
  return spacious ? <DesktopAppearancePanel /> : <LegacyAppearancePanel />;
}

function DesktopAppearancePanel() {
  const {
    preferences: p,
    update,
    reset,
    isSaving,
    saveError,
  } = useAppearance();
  const file = useRef<HTMLInputElement>(null);
  const contrast = contrastRatio(p.text, p.background);
  function download() {
    const url = URL.createObjectURL(
      new Blob([exportColors(p)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `noted-colors-${p.style}-${p.mode}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="settings-panel desktop-appearance">
      <h2>Appearance</h2>
      <p>Colors, text and the way your messages are arranged.</p>
      {saveError && (
        <Notice tone="error">Could not save appearance: {saveError}</Notice>
      )}
      <div className="appearance-columns">
        <div className="appearance-controls">
          <ProfilePicker />
          <AppearanceColorEditor />
          <ReadingOptions />
          {contrast < 4.5 && (
            <p className="settings-hint" role="status">
              Text contrast is low ({contrast.toFixed(1)}:1).
            </p>
          )}
          <label className="range-control">
            <span>
              Text size<output>{p.textSize} px</output>
            </span>
            <input
              aria-label="Text size"
              type="range"
              min={12}
              max={20}
              step={1}
              value={p.textSize}
              onChange={(event) =>
                update({ textSize: Number(event.target.value) })
              }
            />
          </label>
          <div className="appearance-file-actions">
            <Button variant="secondary" onClick={() => file.current?.click()}>
              <Upload size={15} />
              Import colors
            </Button>
            <Button variant="secondary" onClick={download}>
              <Download size={15} />
              Export colors
            </Button>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              hidden
              aria-label="Import colors CSV"
              onChange={async (event) => {
                const selected = event.target.files?.[0];
                event.target.value = "";
                if (!selected) return;
                try {
                  if (selected.size > 32000)
                    throw new Error("The colors file is too large.");
                  update(importColors(await selected.text(), p));
                  toast.success("Colors imported");
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not import colors.",
                  );
                }
              }}
            />
          </div>
          <section className="settings-section">
            <h3>Messages</h3>
            <label className="appearance-setting">
              Message layout
              <select
                aria-label="Message layout"
                value={p.messageLayout}
                onChange={(event) =>
                  update({ messageLayout: event.target.value as MessageLayout })
                }
              >
                {Object.entries(messageLayouts).map(([id, layout]) => (
                  <option key={id} value={id}>
                    {layout.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="appearance-setting">
              Group nearby messages
              <select
                aria-label="Grouping interval"
                value={p.messageGroupMinutes}
                onChange={(event) =>
                  update({ messageGroupMinutes: Number(event.target.value) })
                }
              >
                {Array.from({ length: 30 }, (_, i) => i + 1).map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "minute" : "minutes"}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="settings-section">
            <h3>Interface</h3>
            <label className="range-control">
              <span>
                Interface zoom<output>{p.zoom}%</output>
              </span>
              <input
                aria-label="Interface zoom"
                type="range"
                min={75}
                max={150}
                step={5}
                value={p.zoom}
                onChange={(event) =>
                  update({ zoom: Number(event.target.value) })
                }
              />
            </label>
            <Button variant="secondary" onClick={reset}>
              Reset to defaults
            </Button>
          </section>
          <p className="appearance-save-status" role="status">
            {isSaving ? "Saving appearance..." : "Saved to your account"}
          </p>
          <SavedThemes />
        </div>
        <AppearanceSample />
      </div>
    </section>
  );
}
