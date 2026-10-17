export interface BackupCounts {
  projects: number;
  categories: number;
  channels: number;
  messages: number;
  files: number;
}

export interface BackupPreview {
  token: string;
  created_at: string;
  expires_at: string;
  size: number;
  counts: BackupCounts;
  download_url: string | null;
}

export interface ImportResult {
  counts: BackupCounts;
}
