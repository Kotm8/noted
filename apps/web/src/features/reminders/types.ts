export type RepeatRule = "none" | "daily" | "weekdays" | "weekly";
export interface ReminderSchedule {
  due_at: string;
  timezone: string;
  repeat: RepeatRule;
}
export interface Reminder extends ReminderSchedule {
  status: "active" | "done";
  revision: number;
  scheduled_at: string;
}
