import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { request } from "../../lib/http";
import { androidPilot, isAndroidPilot } from "../../lib/android-pilot";
import { notificationDevice } from "./device";
import {
  devicePushState,
  disableDevicePush,
  enableDevicePush,
} from "./device-push";

export function DevicePushControls() {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [nativeLink, setNativeLink] = useState<string | null>(null);
  const device = useQuery({
    queryKey: ["device-push-state"],
    queryFn: devicePushState,
  });
  const supported = device.data?.supported && device.data.native;
  const permission = device.data?.permission;
  const status = device.isPending
    ? "checking"
    : !supported
      ? "waiting for Firebase setup"
      : permission === "denied"
        ? "blocked in Android settings"
        : permission === "granted" && device.data?.native
          ? "connected"
          : "not connected";

  async function change(enabled: boolean) {
    setPending(true);
    try {
      if (enabled) {
        const link = await enableDevicePush();
        if (link) {
          setNativeLink(link);
          window.location.assign(link);
        } else toast.success("Notifications enabled");
      } else {
        await disableDevicePush();
        setNativeLink(null);
        toast.success("Notifications disabled on this phone");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not change notifications.",
      );
    } finally {
      setPending(false);
      void client.invalidateQueries({ queryKey: ["device-push-state"] });
    }
  }

  async function sendTest() {
    setPending(true);
    try {
      const id = isAndroidPilot
        ? (await androidPilot.notificationState()).deviceId
        : notificationDevice().device_id;
      const result = await request<{
        accepted: number;
        expired: number;
        failed: number;
      }>(`/notifications/test?device_id=${encodeURIComponent(id)}`, "POST");
      if (result.accepted)
        toast.success(
          "Firebase accepted the test. Check your phone for the alert.",
        );
      else if (result.expired)
        toast.error(
          "This phone's registration expired. Enable notifications again.",
        );
      else toast.error("Firebase could not send the test alert.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send a test alert.",
      );
    } finally {
      setPending(false);
      void client.invalidateQueries({ queryKey: ["device-push-state"] });
    }
  }

  return (
    <div className="device-push-controls">
      <p>
        This phone is {status}. Android manages notification permission and the
        Reminders channel.
      </p>
      <div className="dialog-actions">
        <Button
          disabled={pending || !supported}
          onClick={() => void change(true)}
        >
          Enable on this phone
        </Button>
        <Button
          variant="secondary"
          disabled={
            pending || (!device.data?.paired && permission !== "granted")
          }
          onClick={() => void change(false)}
        >
          Disable on this phone
        </Button>
        <Button
          variant="secondary"
          disabled={pending || permission !== "granted"}
          onClick={() => void sendTest()}
        >
          Send a test alert
        </Button>
      </div>
      {nativeLink && permission !== "granted" && (
        <p>
          <a href={nativeLink}>Continue notification setup in Android</a>
        </p>
      )}
      {device.isError && <Notice tone="error">{device.error.message}</Notice>}
    </div>
  );
}
