import { useId, useRef, useState } from "react";
import { Eye, EyeOff, FileJson, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import { firebaseFileLimit } from "../firebase";

interface Props {
  label: string;
  filename: string;
  value: string;
  change: (value: string) => void;
  privateKey?: boolean;
}

export function FirebaseJsonField({
  label,
  filename,
  value,
  change,
  privateKey,
}: Props) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importFile(selected: File | undefined) {
    if (!selected) return;
    setError(null);
    if (selected.size > firebaseFileLimit) {
      setError("Choose a JSON file smaller than 32 KB.");
      return;
    }
    try {
      change(await selected.text());
    } catch {
      setError(
        "Could not read the file. Try again, or paste its contents below.",
      );
    }
  }

  return (
    <div className="firebase-json-field">
      <div className="firebase-field-heading">
        <label htmlFor={id}>{label}</label>
        {privateKey && (
          <Button
            type="button"
            variant="ghost"
            size="small"
            aria-label={
              visible
                ? "Hide service-account JSON"
                : "Show service-account JSON"
            }
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            {visible ? "Hide" : "Show"}
          </Button>
        )}
      </div>
      <textarea
        id={id}
        className={
          privateKey && !visible ? "firebase-json masked-json" : "firebase-json"
        }
        value={value}
        maxLength={firebaseFileLimit}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        placeholder={`Paste the entire ${filename} file here`}
        onChange={(event) => {
          setError(null);
          change(event.target.value);
        }}
      />
      <div className="firebase-file-actions">
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={() => file.current?.click()}
        >
          <FileJson size={14} />
          Import {filename}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="small"
            onClick={() => {
              change("");
              setError(null);
            }}
          >
            <X size={14} />
            Clear
          </Button>
        )}
        <input
          ref={file}
          type="file"
          hidden
          accept=".json,application/json"
          aria-label={`Import ${label}`}
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
