import type { HabitFields } from "../../habits/types";
import type { PlanFields } from "../../schedule/types";
import type { MealItem, Slot } from "../../nutrition/types";
import type { AiSource } from "../api";

export interface HabitChange {
  id: string | null;
  revision: number | null;
  fields: HabitFields;
}
export interface PlanChange {
  id: string | null;
  revision: number | null;
  scope: "series" | "occurrence";
  occurrence_date: string | null;
  fields: PlanFields;
}
export interface MealChange {
  id: string | null;
  revision: number | null;
  fields: {
    day: string;
    minute: number;
    slot: Slot;
    name: string;
    items: MealItem[];
  };
  picture: boolean;
  photo_ids?: string[];
}
/** What the timeline shows on a message while a rewrite is previewed. */
export type AiPreview = Map<string, { text: string; done: boolean }>;
export interface MessageRewrite {
  id: string;
  text: string;
}
export interface PostedReply {
  message_id: string;
  thread_root_id: string;
  channel_id: string;
}
export interface AssistantProposal {
  explanation: string;
  habits: HabitChange[];
  plans: PlanChange[];
  meals: MealChange[];
  rewrites?: MessageRewrite[];
  reply?: string | null;
  draft?: string | null;
  posted?: PostedReply;
  reply_error?: string;
  posts?: MessagePost[];
  deletions?: ItemDeletion[];
  action_results?: ActionResult[];
}
export interface MessagePost {
  channel_id: string;
  text: string;
  destination?: {
    channel_name: string;
    category_name?: string;
    workspace_name: string;
    url: string;
  };
}
export interface ItemDeletion {
  kind: "message" | "journal" | "plan";
  id: string;
  revision?: number | null;
  scope?: "series" | "occurrence" | null;
  occurrence_date?: string | null;
  target?: {
    title: string;
    preview?: string;
    workspace_name?: string;
    channel_name?: string;
    frequency?: string;
    date?: string;
    revision?: number;
    start_minute?: number;
    end_minute?: number;
    timezone?: string;
  };
}
export interface ActionResult {
  key: string;
  ok: boolean;
  error?: string;
  url?: string;
  message_id?: string;
  label?: string;
}
/** Messages a question is about: picked with ✨ on a message, a selection, or a thread. */
export interface AttachedMessages {
  channelId: string;
  channelName: string;
  workspaceId?: string;
  notes: { id: string; content: string }[];
  threadRootId?: string | null;
}
/** How a saved chat remembers what a question was about. */
export interface AttachedSummary {
  channel_id: string;
  channel_name: string;
  message_ids: string[];
  thread_root_id?: string | null;
  prompt_name?: string | null;
}
/** A question or reply in a saved assistant chat. */
export interface ChatTurn {
  id?: string;
  role: "user" | "assistant";
  content: string;
  proposal?: AssistantProposal | null;
  sources?: AiSource[];
  photo_ids?: string[];
  applied?: boolean;
  remembered?: string[];
  attached?: AttachedSummary | null;
}
export interface ChatSummary {
  id: string;
  title: string;
  updated_at: string;
}
