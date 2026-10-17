import { request } from "../../lib/http";
import type { BackupPreview, ImportResult } from "./types";

export const backupsApi = {
  export: () => request<BackupPreview>("/backups/export", "POST"),
  preview: (file: File) => request<BackupPreview>("/backups/preview", "POST", file),
  import: (data: { token: string; mode: "merge" | "replace"; confirmation: string }) =>
    request<ImportResult>("/backups/import", "POST", data),
};
