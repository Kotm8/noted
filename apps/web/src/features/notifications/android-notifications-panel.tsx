import { useQuery } from "@tanstack/react-query";
import { LockKeyhole, Smartphone } from "lucide-react";
import { Notice } from "../../components/ui/notice";
import { androidPushStatus, isAndroidApp } from "./android";
import type { NotificationPreferences } from "./api";
import { AndroidServerSetup } from "./android-server-setup";
import { DevicePushControls } from "./device-push-controls";

export function AndroidNotificationsPanel({
  preferences,
  onChange,
  saving,
}: {
  preferences: NotificationPreferences | undefined;
  onChange: (value: NotificationPreferences) => void;
  saving: boolean;
}) {
  const status = useQuery({
    queryKey: ["android-server-configuration"],
    queryFn: () => androidPushStatus(),
  });
  const configured = status.data?.configured === true;
  return (
    <section
      className="android-notification-settings"
      aria-labelledby="android-notification-heading"
    >
      <header>
        <Smartphone size={18} />
        <h3 id="android-notification-heading">Android notifications</h3>
        <span>
          {status.isPending
            ? "Checking..."
            : configured
              ? "Ready"
              : "Setup required"}
        </span>
      </header>
      <p>
        Connect your own Firebase project to send native notifications from this
        server.
      </p>
      {!configured && (
        <p className="android-setup-required" id="android-setup-required">
          <LockKeyhole size={14} /> Set up Firebase below to unlock Android
          notification settings.
        </p>
      )}
      {status.isError && <Notice tone="error">{status.error.message}</Notice>}
      <fieldset
        className="android-delivery-settings"
        disabled={!configured || !preferences || saving}
        aria-describedby={!configured ? "android-setup-required" : undefined}
      >
        <legend className="visually-hidden">
          Android notification settings
        </legend>
        <label className="notification-enabled">
          <input
            type="checkbox"
            checked={preferences?.android_enabled ?? true}
            onChange={(event) => {
              if (preferences)
                onChange({
                  ...preferences,
                  android_enabled: event.target.checked,
                });
            }}
          />
          Send notifications to Android
        </label>
        <p>
          Uses your reminder timing and snooze preferences above. Phone alerts
          are suppressed while Noted is focused on your PC.
        </p>
        {isAndroidApp() ? (
          <DevicePushControls android />
        ) : (
          <p>
            Open the latest Noted APK and enable notifications to connect your
            phone.
          </p>
        )}
      </fieldset>
      {(!status.isPending || status.data) && (
        <AndroidServerSetup status={status.data} />
      )}
    </section>
  );
}
