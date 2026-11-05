import { useQuery } from "@tanstack/react-query";
import { request } from "../../lib/http";
import { liveInterval } from "../../lib/live";
import type { SchedulePlan } from "../schedule/types";
import type { DayTemplate, NoteTemplate } from "./types";

export const templatesApi = {
  notes: () => request<NoteTemplate[]>("/templates/notes"),
  days: () => request<DayTemplate[]>("/templates/days"),
  saveNote: (data: NoteTemplate) =>
    data.id
      ? request<NoteTemplate>(`/templates/notes/${data.id}`, "PUT", {
          name: data.name,
          content: data.content,
          revision: data.revision,
        })
      : request<NoteTemplate>("/templates/notes", "POST", {
          name: data.name,
          content: data.content,
        }),
  saveDay: (data: DayTemplate) =>
    data.id
      ? request<DayTemplate>(`/templates/days/${data.id}`, "PUT", {
          name: data.name,
          blocks: data.blocks,
          revision: data.revision,
        })
      : request<DayTemplate>("/templates/days", "POST", {
          name: data.name,
          blocks: data.blocks,
        }),
  remove: (kind: "notes" | "days", id: string, revision: number) =>
    request<void>(`/templates/${kind}/${id}?revision=${revision}`, "DELETE"),
  capture: (name: string, date: string, timezone: string) =>
    request<DayTemplate>("/templates/days/capture", "POST", {
      name,
      date,
      timezone,
    }),
  apply: (
    template: DayTemplate,
    date: string,
    timezone: string,
    requestId: string,
  ) =>
    request<{ plans: SchedulePlan[] }>(
      `/templates/days/${template.id}/apply`,
      "POST",
      { date, timezone, revision: template.revision, request_id: requestId },
    ),
};

export function useNoteTemplates(enabled = true) {
  return useQuery({
    queryKey: ["templates", "notes"],
    queryFn: templatesApi.notes,
    enabled,
    refetchInterval: () => liveInterval(30000),
  });
}
export function useDayTemplates(enabled = true) {
  return useQuery({
    queryKey: ["templates", "days"],
    queryFn: templatesApi.days,
    enabled,
    refetchInterval: () => liveInterval(30000),
  });
}
