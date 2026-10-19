import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { notificationsApi, type NotificationPreferences } from "./api";
import { isAndroidApp } from "./android";
import { AndroidNotificationsPanel } from "./android-notifications-panel";
import { DevicePushControls } from "./device-push-controls";
import { Select } from "../../components/ui/select";

export function NotificationsPanel() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["notification-settings"],
    queryFn: notificationsApi.settings,
  });
  const [minutes, setMinutes] = useState<number | null>(null);
  const save = useMutation({
    mutationFn: notificationsApi.save,
    onMutate: (values) => {
      const previous = client.getQueryData<NotificationPreferences>([
        "notification-settings",
      ]);
      client.setQueryData(["notification-settings"], values);
      return { previous };
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notification-settings"] });
      toast.success("Notification settings saved");
    },
    onError: (error, _values, context) => {
      if (context?.previous)
        client.setQueryData(["notification-settings"], context.previous);
      toast.error(error.message);
    },
  });
  return (
    <section className="settings-panel">
      <h2>Notifications</h2>
      <p>
        Reminder settings follow your account. Notification permission belongs
        to this device.
      </p>
      {settings.isError && (
        <Notice tone="error">{settings.error.message}</Notice>
      )}
      {settings.data && (
        <form
          className="management-form"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              ...settings.data!,
              snooze_minutes: minutes ?? settings.data!.snooze_minutes,
            });
          }}
        >
          <label>
            Default snooze (minutes)
            <input
              type="number"
              min={1}
              max={10080}
              required
              value={minutes ?? settings.data.snooze_minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <label className="notification-enabled">
            <input
              type="checkbox"
              checked={settings.data.enabled}
              disabled={save.isPending}
              onChange={(event) =>
                save.mutate({
                  ...settings.data!,
                  enabled: event.target.checked,
                })
              }
            />
            Enable reminder delivery on all devices
          </label>
          <label>
            Planned activity notification
            <Select
              label="Default planned activity notification"
              value={String(settings.data.plan_notice_minutes ?? 0)}
              options={[
                { value: "10", label: "10 minutes before" },
                { value: "5", label: "5 minutes before" },
                { value: "1", label: "1 minute before" },
                { value: "0", label: "At the start" },
              ]}
              onChange={(value) =>
                save.mutate({
                  ...settings.data!,
                  plan_notice_minutes: Number(value) as 0 | 1 | 5 | 10,
                })
              }
            />
          </label>
          <Button disabled={save.isPending} type="submit">
            Save preferences
          </Button>
        </form>
      )}
      {!isAndroidApp() && (
        <section className="browser-notification-settings">
          <h3>This browser</h3>
          <DevicePushControls />
        </section>
      )}
      <AndroidNotificationsPanel
        preferences={settings.data}
        onChange={(values) => save.mutate(values)}
        saving={save.isPending}
      />
    </section>
  );
}
