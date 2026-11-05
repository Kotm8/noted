import type { AiTurn } from "../api";
import type { SchedulePlan } from "../../schedule/types";

export interface CalendarScope {
  start: string;
  end: string;
  timezone: string;
  start_minute: number;
  end_minute: number;
}

export interface CalendarBlock {
  activity_id: string;
  title: string;
  date: string;
  start_minute: number;
  end_minute: number;
  notifications_enabled: boolean;
  notification_minutes: 0 | 1 | 5 | 10 | null;
}

export interface CalendarProposal {
  explanation: string;
  blocks: CalendarBlock[];
}

export interface CalendarRequest extends CalendarScope {
  instructions: string;
  history: AiTurn[];
  proposals: CalendarBlock[];
}

export interface PreviewPlan extends CalendarBlock {
  id: string;
  selected: boolean;
}

export interface CalendarApplication {
  request_id: string;
  revision: number;
  applied: boolean;
  plans: SchedulePlan[];
}
