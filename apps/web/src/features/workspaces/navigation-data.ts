import type { QueryClient } from "@tanstack/react-query";
import { readStoredValue } from "../../lib/storage";
import { request } from "../../lib/http";
import { notesQuery } from "../notes/queries";
import { documentQuery } from "../notes/documents/queries";
import { journalsQuery } from "../journals/queries";
import { journalsApi } from "../journals/api";
import { threadQuery } from "../threads/queries";
import { publishingApi } from "../publishing/api";
import { trackingApi } from "../time-tracking/api";
import { scheduleApi } from "../schedule/api";
import { addDays, wallTime, weekDays, zonedParts } from "../schedule/dates";
import type { HomeActivityPage } from "../home/types";
import type { PlanPrompt } from "../schedule/prompts";
import { categoryApi, channelApi, workspaceApi } from "./api";
import type { Channel } from "./types";

export interface ChannelDestination {
  workspaceId: string;
  channelId?: string;
  noteId?: string;
  journalEntryId?: string;
  threadId?: string;
  replyId?: string;
}

export async function prepareChannel(
  client: QueryClient,
  channel: Channel,
  targetId?: string,
) {
  if (channel.kind === "document")
    await client.ensureQueryData({
      ...documentQuery(channel),
      revalidateIfStale: true,
    });
  else if (channel.kind === "journal")
    await client.ensureInfiniteQueryData({
      ...journalsQuery(channel.id),
      revalidateIfStale: true,
    });
  else
    await client.ensureInfiniteQueryData({
      ...notesQuery(channel.id, targetId),
      revalidateIfStale: true,
    });
}

export async function prepareDestination(
  client: QueryClient,
  target: ChannelDestination,
  allowFallback = false,
) {
  const [, channels] = await Promise.all([
    client.ensureQueryData({
      queryKey: ["categories", target.workspaceId],
      queryFn: () => categoryApi.list(target.workspaceId),
      revalidateIfStale: true,
    }),
    client.ensureQueryData({
      queryKey: ["channels", target.workspaceId],
      queryFn: () => channelApi.list(target.workspaceId),
      revalidateIfStale: true,
    }),
  ]);
  const selectedId =
    target.channelId ?? readStoredValue(`noted.channel.${target.workspaceId}`);
  const selected =
    channels.find((channel) => channel.id === selectedId) ??
    (target.channelId && !allowFallback ? undefined : channels[0]);
  if (target.channelId && !selected)
    throw new Error("This channel is no longer available.");
  if (!selected) return undefined;
  await Promise.all([
    prepareChannel(
      client,
      selected,
      selected.id === target.channelId ? target.noteId : undefined,
    ),
    client.ensureQueryData({
      queryKey: ["publishing", "writing", selected.id],
      queryFn: () => publishingApi.writing(selected.id),
      revalidateIfStale: true,
    }),
    target.journalEntryId
      ? client.ensureQueryData({
          queryKey: ["journal-entry", target.journalEntryId],
          queryFn: () => journalsApi.get(target.journalEntryId!),
        })
      : undefined,
    target.threadId
      ? client.ensureInfiniteQueryData({
          ...threadQuery(target.threadId, target.replyId),
          revalidateIfStale: true,
        })
      : undefined,
  ]);
  return selected;
}

export async function prepareStartup(client: QueryClient, url: URL) {
  const [workspaces, tracker] = await Promise.all([
    client.ensureQueryData({
      queryKey: ["workspaces"],
      queryFn: workspaceApi.list,
    }),
    client.ensureQueryData({
      queryKey: ["time-tracker"],
      queryFn: trackingApi.tracker,
    }),
    client.ensureQueryData({
      queryKey: ["activities"],
      queryFn: trackingApi.activities,
    }),
    url.searchParams.has("prompt")
      ? client.ensureQueryData({
          queryKey: ["plan-prompts"],
          queryFn: () => request<PlanPrompt[]>("/schedule/prompts"),
        })
      : undefined,
  ]);
  if (["/", "/home", "/schedule"].includes(url.pathname)) {
    const timezone = tracker.preferences.timezone;
    const date = zonedParts(Date.now(), timezone).date;
    const days = url.pathname === "/schedule" ? weekDays(date) : [date];
    const start = wallTime(days[0], 0, timezone);
    const end = wallTime(addDays(days.at(-1)!, 1), 0, timezone);
    await Promise.all([
      client.ensureQueryData({
        queryKey: ["schedule", start, end],
        queryFn: () => scheduleApi.board(start, end),
      }),
      url.pathname !== "/schedule"
        ? client.ensureQueryData({
            queryKey: ["home-activity", 50],
            queryFn: () => request<HomeActivityPage>("/home/activity?limit=50"),
          })
        : undefined,
    ]);
  } else if (workspaces.length) {
    const parts = url.pathname.match(/^\/w\/([^/]+)(?:\/c\/([^/]+))?$/);
    const workspaceId = workspaces.find((item) => item.id === parts?.[1])?.id;
    const savedPath = readStoredValue("noted.navigation");
    const saved = savedPath?.match(/^\/w\/([^/]+)(?:\/c\/([^/]+))?$/);
    const fallback = workspaces.find((item) => item.id === saved?.[1]);
    await prepareDestination(
      client,
      {
        workspaceId: workspaceId ?? fallback?.id ?? workspaces[0].id,
        channelId: workspaceId ? parts?.[2] : fallback ? saved?.[2] : undefined,
        noteId: url.searchParams.get("note") ?? undefined,
      },
      true,
    );
  }
}
