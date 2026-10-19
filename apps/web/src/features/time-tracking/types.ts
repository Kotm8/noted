export const activityIcons = [
  "Code2",
  "BookOpen",
  "BriefcaseBusiness",
  "Trees",
  "Coffee",
  "Laptop",
  "Moon",
  "Sun",
  "Flag",
  "Activity",
] as const;
export type ActivityIconName = (typeof activityIcons)[number];
export interface Activity {
  id: string;
  name: string;
  icon: ActivityIconName;
  color: string;
  archived: boolean;
  position: number;
  revision: number;
}
export interface TimeSession {
  id: string;
  activity_id: string;
  started_at: string;
  ended_at: string | null;
  revision: number;
}
export interface TrackingPreferences {
  start_minute: number;
  end_minute: number;
  timezone: string;
}
export interface Tracker {
  revision: number;
  active: TimeSession | null;
  paused_activity_id: string | null;
  elapsed_seconds: number;
  server_time: string;
  preferences: TrackingPreferences;
}
export type TrackerAction = "start" | "pause" | "resume" | "stop";
