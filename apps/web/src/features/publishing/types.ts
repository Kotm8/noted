export interface ScheduledFields {
  content: string;
  send_at: string;
  timezone: string;
}

export interface ScheduledMessage extends ScheduledFields {
  id: string;
  channel_id: string;
  revision: number;
  status: "pending" | "sent" | "skipped" | "cancelled";
  message_id: string | null;
}

export interface WritingFields {
  content: string;
  start_at: string;
  timezone: string;
  frequency: "daily" | "weekly" | "biweekly" | "monthly";
  weekdays: number[];
  enabled: boolean;
}

export interface WritingPrompt extends WritingFields {
  id: string;
  channel_id: string;
  revision: number;
  next_at: string | null;
  due_at: string | null;
}
