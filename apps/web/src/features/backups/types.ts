export interface BackupCounts {
  finance_entries?: number;
  habits: number;
  meals?: number;
  assistant_chats?: number;
  day_templates?: number;
  note_templates?: number;
  projects: number;
  categories: number;
  channels: number;
  messages: number;
  files: number;
  journals?: number;
  documents?: number;
  activities?: number;
  time_sessions?: number;
  schedule_plans?: number;
  scheduled_messages?: number;
  writing_prompts?: number;
}

export interface BackupPreview {
  warnings?: string[];
  has_preferences?: boolean;
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
