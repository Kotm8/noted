export interface JournalSummary {
  id: string;
  channel_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry extends JournalSummary {
  content: string;
  revision: number;
}

export interface JournalDraft {
  title: string;
  content: string;
  revision: number;
}
