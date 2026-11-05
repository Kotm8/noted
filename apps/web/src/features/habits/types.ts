export interface HabitFields {
  name: string;
  kind: "check" | "count" | "time";
  goal: number;
  unit: string;
  period: "Morning" | "Anytime" | "Evening";
  weekdays: number[];
  activity_id: string | null;
  timezone: string;
  starts_on: string;
  reminder_minute: number | null;
  reminder_start: string | null;
}
export interface Habit extends HabitFields {
  id: string;
  revision: number;
}
export interface HabitProgress {
  habit_id: string;
  day: string;
  value: number;
  revision: number;
  due: boolean;
}
export interface HabitBoard {
  habits: Habit[];
  progress: HabitProgress[];
}
