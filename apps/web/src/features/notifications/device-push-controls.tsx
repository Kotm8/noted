import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { disablePush } from "./browser";
import { devicePushState, enableDevicePush } from "./device-push";

export function DevicePushControls({ android = false }: { android?: boolean }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [nativeLink, setNativeLink] = useState<string | null>(null);
  const device = useQuery({
    queryKey: ["device-push-state"],
    queryFn: devicePushState,
  });
  const supported = device.data?.supported && (!android || device.data.native);
  const permission = device.data?.permission;
  const deviceLabel = android ? "phone" : "browser";

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
        await disablePush();
        setNativeLink(null);
        toast.success(`Notifications disabled on this ${deviceLabel}`);
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

  return (
    <div className="device-push-controls">
      <p>
        {android
          ? `This phone: ${permission === "granted" && device.data?.native ? "connected" : "not connected"}. Permission is managed in Android app settings.`
          : supported
            ? `Browser permission: ${permission ?? "checking..."}`
            : "Web Push is available in supported browsers over HTTPS."}
      </p>
      <div className="dialog-actions">
        <Button
          disabled={pending || !supported}
          onClick={() => void change(true)}
        >
          {android ? "Enable on this phone" : "Enable notifications"}
        </Button>
        <Button
          variant="secondary"
          disabled={pending || !supported}
          onClick={() => void change(false)}
        >
          Disable on this {deviceLabel}
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
