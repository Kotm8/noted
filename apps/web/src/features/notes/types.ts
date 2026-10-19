import type { Reminder } from "../reminders/types";

export interface Note {
  thread_root_id?: string | null;
  reply_count?: number;
  reminder?: Reminder | null;
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  attachments: Attachment[];
}

export interface Attachment {
  id: string;
  original_filename: string;
  content_type: string;
  size: number;
  download_url: string;
  preview_url: string | null;
  playback_url?: string | null;
}

export interface NoteCursor {
  before?: string;
  after?: string;
  around?: string;
}

export interface NotePage {
  items: Note[];
  next_cursor: string | null;
  newer_cursor: string | null;
}
