import { Notice } from "../../../components/ui/notice";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { backupsApi } from "../api";
import type { BackupPreview } from "../types";
import { BackupSummary } from "./backup-summary";

export function BackupsPanel() {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmation, setConfirmation] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const exported = useMutation({ mutationFn: backupsApi.export });
  const uploaded = useMutation({ mutationFn: backupsApi.preview, onSuccess: setPreview });
  const restored = useMutation({
    mutationFn: backupsApi.import,
    onSuccess: () => {
      setPreview(null);
      setConfirmation("");
      void client.invalidateQueries();
    },
  });
  const busy = exported.isPending || uploaded.isPending || restored.isPending;
  const error = exported.error ?? uploaded.error ?? restored.error;

  return (
    <section className="settings-panel backups-panel">
      <h2>Backups</h2>
      <p>
        Take your notes with you. ZIP backups include projects, categories, channels, messages,
        attachments, and project images.
      </p>
      <p className="settings-hint">
        Login details, passwords, sessions, and server configuration are excluded. The owner signed
        in during import receives the content.
      </p>
      <div className="settings-section">
        <h3>Export your content</h3>
        <p>
          Generate a ZIP, then save it somewhere you trust. Backups contain your private notes and
          files and are not encrypted.
        </p>
        <Button
          disabled={busy}
          onClick={() => {
            exported.reset();
            uploaded.reset();
            restored.reset();
            exported.mutate();
          }}
        >
          <Download size={15} />
          {exported.isPending ? "Generating backup..." : "Generate backup ZIP"}
        </Button>
        {exported.data && (
          <div className="backup-preview" role="status">
            <BackupSummary counts={exported.data.counts} />
            <p>
              {(exported.data.size / 1024 / 1024).toFixed(1)} MB. Download available for one hour.
            </p>
            <Button asChild variant="secondary">
              <a href={exported.data.download_url ?? undefined} download>
                Download backup ZIP
              </a>
            </Button>
          </div>
        )}
      </div>
      <div className="settings-section">
        <h3>Import a backup</h3>
        <p>Choose a Noted ZIP to verify and preview it before importing. Maximum ZIP size: 1 GB.</p>
        <Button disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload size={15} />
          Choose backup ZIP
        </Button>
        <input
          ref={fileInput}
          hidden
          aria-label="Choose backup ZIP"
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            setPreview(null);
            setMode("merge");
            setConfirmation("");
            restored.reset();
            uploaded.reset();
            exported.reset();
            setFileError(null);
            if (file.size > 1024 * 1024 * 1024) {
              setFileError("Choose a backup ZIP no larger than 1 GB.");
              return;
            }
            uploaded.mutate(file);
          }}
        />
        {uploaded.isPending && <Notice>Uploading and verifying the backup...</Notice>}
        {preview && (
          <div className="backup-preview">
            <p>Backup from {new Date(preview.created_at).toLocaleString()}</p>
            <BackupSummary counts={preview.counts} />
            <fieldset className="import-options">
              <legend>How should this content be imported?</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                  disabled={busy}
                />
                Add as new projects, keeping existing notes
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === "replace"}
                  onChange={() => setMode("replace")}
                  disabled={busy}
                />
                Replace all projects, channels, messages, and files in the app
              </label>
            </fieldset>
            {mode === "replace" && (
              <label>
                Type REPLACE MY NOTES to confirm
                <input
                  aria-label="Replace confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <Button
              variant={mode === "replace" ? "danger" : "default"}
              disabled={busy || (mode === "replace" && confirmation !== "REPLACE MY NOTES")}
              onClick={() => restored.mutate({ token: preview.token, mode, confirmation })}
            >
              {restored.isPending ? "Importing..." : "Import backup"}
            </Button>
          </div>
        )}
        {restored.isSuccess && (
          <div>
            <Notice>Backup imported. Your sign-in credentials are unchanged.</Notice>
            <BackupSummary counts={restored.data.counts} />
          </div>
        )}
      </div>
      {fileError && <Notice tone="error">{fileError}</Notice>}
      {error && <Notice tone="error">{error.message}</Notice>}
    </section>
  );
}
