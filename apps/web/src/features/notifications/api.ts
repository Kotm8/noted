import { request } from "../../lib/http";

export interface NotificationPreferences {
  enabled: boolean;
  android_enabled?: boolean;
  snooze_minutes: number;
  plan_notice_minutes?: 0 | 1 | 5 | 10;
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
