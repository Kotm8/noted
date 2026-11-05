import { request } from "../../../lib/http";
import type {
  CalendarApplication,
  CalendarBlock,
  CalendarScope,
} from "./types";

export const calendarAiApi = {
  apply: (scope: CalendarScope, blocks: CalendarBlock[], requestId: string) =>
    request<CalendarApplication>("/ai/calendar/applications", "POST", {
      ...scope,
      blocks,
      request_id: requestId,
    }),
  update: (application: CalendarApplication, applied: boolean) =>
    request<CalendarApplication>(
      `/ai/calendar/applications/${application.request_id}`,
      "PUT",
      {
        revision: application.revision,
        applied,
      },
    ),
};
