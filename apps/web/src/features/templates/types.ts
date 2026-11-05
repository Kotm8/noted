import type { PlanFields } from "../schedule/types";

export interface TemplateRecord {
  id: string;
  name: string;
  revision: number;
}
export interface NoteTemplate extends TemplateRecord {
  content: string;
}
export type DayBlock = Pick<
  PlanFields,
  | "activity_id"
  | "title"
  | "start_minute"
  | "end_minute"
  | "notifications_enabled"
  | "notification_minutes"
  | "writing_nudge"
>;
export interface DayTemplate extends TemplateRecord {
  blocks: DayBlock[];
}
