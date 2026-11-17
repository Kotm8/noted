import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { request } from "../../../lib/http";
import { useAppearance } from "../appearance-context";
import type { AppearanceTheme } from "../appearance";

export function SavedThemes() {
  const { preferences, update } = useAppearance();
  const [name, setName] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const { savedThemes, ...theme } = preferences;
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "noted-theme.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="settings-section">
      <h3>Saved themes</h3>
      <div className="appearance-file-actions">
        <input
          aria-label="Theme name"
          placeholder="Theme name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!name.trim() || Object.keys(savedThemes).length >= 20}
          onClick={() => {
            update({ savedThemes: { ...savedThemes, [name.trim()]: theme } });
            setName("");
          }}
        >
          Save a copy
        </Button>
      </div>
      {Object.entries(savedThemes).map(([key, value]) => (
        <div className="appearance-file-actions" key={key}>
          <Button variant="secondary" onClick={() => update(value)}>
            {key}
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              update({
                savedThemes: Object.fromEntries(
                  Object.entries(savedThemes).filter(([name]) => name !== key),
                ),
              })
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="appearance-file-actions">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          Import theme JSON
        </Button>
        <Button variant="secondary" onClick={download}>
          Export theme JSON
        </Button>
      </div>
      <input
        ref={file}
        type="file"
        hidden
        accept=".json,application/json"
        aria-label="Import theme JSON"
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (!selected) return;
          try {
            if (selected.size > 100000)
              throw new Error("The theme file is too large.");
            const validated = await request<AppearanceTheme>(
              "/settings/appearance/validate",
              "POST",
              JSON.parse(await selected.text()),
            );
            update(validated);
            toast.success("Theme imported");
          } catch (error) {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not import theme.",
            );
          }
        }}
      />
    </section>
  );
}
