import { request } from "../../../lib/http";
import type { WritingDraft } from "../../writing/use-writing-draft";

interface ChannelDocument {
  channel_id: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface NoteDocument extends ChannelDocument {
  id: string;
  title: string;
}

export function documentApi(title: string) {
  const record = (document: ChannelDocument): NoteDocument => ({
    ...document,
    id: document.channel_id,
    title,
  });
  return {
    get: async (channelId: string) =>
      record(await request<ChannelDocument>(`/channels/${channelId}/document`)),
    update: async (channelId: string, draft: WritingDraft) =>
      record(
        await request<ChannelDocument>(
          `/channels/${channelId}/document`,
          "PUT",
          { content: draft.content, revision: draft.revision },
        ),
      ),
  };
}
