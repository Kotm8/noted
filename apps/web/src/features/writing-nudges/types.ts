export interface WritingNudgeSettings {
  enabled: boolean;
  interval_minutes: number;
  content: string;
  channel_id: string | null;
  on_stop: boolean;
}

export const defaultWritingNudge: WritingNudgeSettings = {
  enabled: false,
  interval_minutes: 30,
  content: "Write a quick update.",
  channel_id: null,
  on_stop: true,
};

export interface WritingNudge {
  id: string;
  channel_id: string;
  content: string;
  due_at: string;
  revision: number;
}
