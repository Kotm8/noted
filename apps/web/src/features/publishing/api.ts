import { request } from "../../lib/http";
import type {
  ScheduledFields,
  ScheduledMessage,
  WritingFields,
  WritingPrompt,
} from "./types";

export const publishingApi = {
  list: (channelId: string) =>
    request<ScheduledMessage[]>(`/channels/${channelId}/scheduled-messages`),
  create: (channelId: string, data: ScheduledFields) =>
    request<ScheduledMessage>(
      `/channels/${channelId}/scheduled-messages`,
      "POST",
      data,
    ),
  update: (id: string, revision: number, data: ScheduledFields) =>
    request<ScheduledMessage>(`/scheduled-messages/${id}`, "PUT", {
      ...data,
      revision,
    }),
  cancel: (id: string, revision: number) =>
    request<void>(`/scheduled-messages/${id}?revision=${revision}`, "DELETE"),
  writing: (channelId: string) =>
    request<WritingPrompt | null>(`/channels/${channelId}/writing-prompt`),
  saveWriting: (channelId: string, revision: number, data: WritingFields) =>
    request<WritingPrompt>(`/channels/${channelId}/writing-prompt`, "PUT", {
      ...data,
      revision,
    }),
  dismiss: (channelId: string, revision: number) =>
    request<void>(
      `/channels/${channelId}/writing-prompt/dismiss?revision=${revision}`,
      "POST",
    ),
};
