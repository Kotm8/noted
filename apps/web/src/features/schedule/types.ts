import type { TimeSession } from "../time-tracking/types";

export type Frequency = "none" | "daily" | "weekly" | "biweekly" | "monthly";
export interface PlanFields {
  activity_id: string;
  title: string;
  date: string;
  start_minute: number;
  end_minute: number;
  timezone: string;
  notifications_enabled?: boolean;
  notification_minutes?: 0 | 1 | 5 | 10 | null;
  frequency: Frequency;
  weekdays: number[];
  repeat_until: string | null;
}
export interface SchedulePlan extends PlanFields {
  id: string;
  revision: number;
}
export interface PlanOccurrence extends SchedulePlan {
  occurrence_date: string;
  start_at: string;
  end_at: string;
  is_override: boolean;
}
export interface ReminderFlag {
  revision?: number;
  message_id: string;
  channel_id: string;
  channel_name: string;
  workspace_id: string;
  workspace_name: string;
  content: string;
  due_at: string;
}
export interface ScheduleBoard {
  plans: PlanOccurrence[];
  sessions: TimeSession[];
  reminders: ReminderFlag[];
}
export interface PlanUpdate extends PlanFields {
  revision: number;
  scope: "series" | "occurrence";
  occurrence_date?: string;
}
