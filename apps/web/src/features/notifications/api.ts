import { request } from "../../lib/http";

export interface NotificationPreferences {
  enabled: boolean;
  snooze_minutes: number;
}
export const notificationsApi = {
  settings: () => request<NotificationPreferences>("/notifications/settings"),
  save: (settings: NotificationPreferences) =>
    request<NotificationPreferences>(
      "/notifications/settings",
      "PUT",
      settings,
    ),
};
