export interface AvailableRelease {
  commit: string;
  version: string;
  sequence: number;
  manifest_sha256: string;
  url: string;
  notes: string;
  published_at: string;
}

export interface UpdateJob {
  id: string;
  commit: string;
  status: "queued" | "running" | "succeeded" | "failed" | "needs_recovery";
  phase: string;
  detail: string;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface UpdateStatus {
  configured: boolean;
  worker_online: boolean;
  repository: string | null;
  installed: { commit: string; version: string; sequence: number; schema: string } | null;
  latest: AvailableRelease | null;
  available: boolean;
  last_checked: string | null;
  check_error: string | null;
  download_commit: string | null;
  download_status: "downloading" | "ready" | "failed" | null;
  download_error: string | null;
  job: UpdateJob | null;
}
