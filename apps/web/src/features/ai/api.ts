import { fetchResponse, request } from "../../lib/http";
import type { CalendarProposal, CalendarRequest } from "./calendar/types";

export type AiKind = "rewrite" | "reply" | "draft" | "answer";
export type AiPlace = "messages" | "journals" | "documents" | "composer";
export type AiThinking = "low" | "medium" | "high" | "xhigh";

export interface AiStatus {
  connected: boolean;
  plan?: string | null;
  account?: string;
  connected_at?: string;
  usage?: {
    five_hours_percent: number | null;
    week_percent: number | null;
    five_hours_resets_at: string | null;
    week_resets_at: string | null;
  } | null;
}

export interface AiPreferences {
  model: string;
  thinking: AiThinking;
  standing_note: string;
  calendar_note: string;
  web_search: boolean;
  keep_history: boolean;
}

export interface AiModel {
  id: string;
  name: string;
  description: string;
  thinking: string[];
}

export interface AiPromptFields {
  name: string;
  instructions: string;
  kind: AiKind;
  places: AiPlace[];
  sees: "selection" | "channel_today";
  model: string | null;
}

export interface AiPrompt extends AiPromptFields {
  id: string;
  position: number;
  revision: number;
}

export interface AiRun {
  id: string;
  created_at: string;
  prompt_name: string;
  instructions: string;
  kind: AiKind;
  place: AiPlace | "calendar";
  channel_id: string | null;
  conversation_id: string | null;
  where: string;
  model: string;
  input: { id?: string; text: string }[];
  output: unknown;
  outcome: string;
  error: string | null;
  usage: {
    sources?: AiSource[];
    thought_seconds?: number;
    searched?: boolean;
  } | null;
}

export interface AiSource {
  url: string;
  title: string;
  kind?: "message" | "journal" | "document";
}
export interface AiConversation {
  id: string;
  question: string;
  turns: number;
  updated_at: string;
}
export interface AiTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiChange {
  id: string;
  text: string;
}

export interface AiRunInput {
  prompt_id?: string;
  instructions?: string;
  kind?: AiKind;
  place: AiPlace;
  channel_id?: string;
  message_ids?: string[];
  entry_ids?: string[];
  conversation_id?: string;
  history?: AiTurn[];
  text?: string;
  where?: string;
}

export type AiEvent =
  | {
      type: "start";
      run_id: string | null;
      kind: AiKind;
      prompt_name: string;
      model: string;
    }
  | { type: "thinking"; heading?: string }
  | {
      type: "search";
      query: string;
      scope?: "web" | "noted";
      action?: "search" | "read" | "image";
    }
  | { type: "sources"; sources: AiSource[] }
  | { type: "changes"; changes: AiChange[]; thought_seconds?: number }
  | { type: "text"; text: string; thought_seconds?: number }
  | {
      type: "done";
      output: AiChange[] | string | CalendarProposal;
      sources?: AiSource[];
      thought_seconds?: number;
      searched?: boolean;
    }
  | { type: "error"; code: string; message: string };

export const aiApi = {
  status: () => request<AiStatus>("/ai/status"),
  connect: (auth_json: string) =>
    request<AiStatus>("/ai/connection", "POST", { auth_json }),
  disconnect: () => request<void>("/ai/connection", "DELETE"),
  startSignIn: () => request<{ url: string }>("/ai/connection/sign-in", "POST"),
  finishSignIn: (address: string) =>
    request<AiStatus>("/ai/connection/sign-in/finish", "POST", { address }),
  models: () => request<AiModel[]>("/ai/models"),
  preferences: () => request<AiPreferences>("/ai/preferences"),
  savePreferences: (value: AiPreferences) =>
    request<AiPreferences>("/ai/preferences", "PUT", value),
  prompts: () => request<AiPrompt[]>("/ai/prompts"),
  createPrompt: (value: AiPromptFields) =>
    request<AiPrompt>("/ai/prompts", "POST", value),
  updatePrompt: (prompt: AiPrompt) =>
    request<AiPrompt>(`/ai/prompts/${prompt.id}`, "PUT", prompt),
  deletePrompt: (id: string) => request<void>(`/ai/prompts/${id}`, "DELETE"),
  reorderPrompts: (ids: string[]) =>
    request<AiPrompt[]>("/ai/prompts/order", "PUT", { ids }),
  runs: () => request<AiRun[]>("/ai/runs?limit=500"),
  conversations: (channelId: string) =>
    request<AiConversation[]>(`/ai/conversations?channel_id=${channelId}`),
  conversation: (id: string) => request<AiRun[]>(`/ai/conversations/${id}`),
  setOutcome: (id: string, outcome: string) =>
    request<AiRun>(`/ai/runs/${id}`, "PUT", { outcome }),
  deleteRun: (id: string) => request<void>(`/ai/runs/${id}`, "DELETE"),
  clearRuns: () => request<void>("/ai/runs", "DELETE"),
};

/**
 * Runs a prompt and calls `onEvent` for each event as the answer is written. The server sends
 * newline-delimited JSON; partial lines wait for the rest of their chunk.
 */
export async function runAi(
  input: AiRunInput | CalendarRequest,
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
  path = "/ai/runs",
): Promise<void> {
  const response = await fetchResponse(path, "POST", input, signal);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines)
        if (line.trim()) onEvent(JSON.parse(line) as AiEvent);
      if (done) break;
    }
    if (pending.trim()) onEvent(JSON.parse(pending) as AiEvent);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
