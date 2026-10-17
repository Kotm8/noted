import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { notificationsApi, type NotificationPreferences } from "./api";
import { disablePush, enablePush, pushPermission, supportsPush } from "./browser";
import { isAndroidApp } from "./android";

export function NotificationsPanel() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["notification-settings"],
    queryFn: notificationsApi.settings,
  });
  const [pending, setPending] = useState(false);
  const [permission, setPermission] = useState("Checking permission...");
  const deviceLabel = isAndroidApp() ? "phone" : "browser";
  useEffect(() => {
    if (supportsPush()) void pushPermission().then(setPermission).catch(() => setPermission("Unavailable"));
  }, [pending]);
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
        Reminder settings follow your account. Notification permission belongs to
        this device.
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
          <Button disabled={save.isPending} type="submit">
            Save preferences
          </Button>
        </form>
      )}
      <h3>This {deviceLabel}</h3>
      <p>
        {supportsPush()
          ? `Permission: ${permission}`
          : "Web Push is available in supported browsers over HTTPS."}
      </p>
      <div className="dialog-actions">
        <Button
          disabled={pending || !supportsPush()}
          onClick={() => {
            setPending(true);
            void enablePush()
              .then(() => toast.success("Notifications enabled"))
              .catch((error: Error) => toast.error(error.message))
              .finally(() => setPending(false));
          }}
        >
          Enable notifications
        </Button>
        <Button
          variant="secondary"
          disabled={pending || !supportsPush()}
          onClick={() => {
            setPending(true);
            void disablePush()
              .then(() =>
                toast.success(`Notifications disabled on this ${deviceLabel}`),
              )
              .catch((error: Error) => toast.error(error.message))
              .finally(() => setPending(false));
          }}
        >
          Disable on this {deviceLabel}
        </Button>
      </div>
    </section>
  );
}
