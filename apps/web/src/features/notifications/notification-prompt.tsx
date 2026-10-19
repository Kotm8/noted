import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { registerPush } from "./browser";
import { devicePushState, enableDevicePush } from "./device-push";

export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [nativeLink, setNativeLink] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const reconnect = async () => {
      if (localStorage.getItem("noted.push-disabled") === "yes") return;
      const state = await devicePushState();
      if (!state.supported) return;
      const permission = state.permission;
      if (active)
        setVisible(
          permission === "default" &&
            sessionStorage.getItem("noted.notifications-later") !== "yes",
        );
      if (permission === "granted") {
        if (active) {
          setVisible(false);
          setNativeLink(null);
        }
        if (!state.native) await registerPush();
      }
    };
    const resume = () => {
      void reconnect().catch(() =>
        toast.error(
          "Could not reconnect notifications. Try enabling them in Settings.",
        ),
      );
    };
    resume();
    window.addEventListener("focus", resume);
    return () => {
      active = false;
      window.removeEventListener("focus", resume);
    };
  }, []);
  if (!visible) return null;
  return (
    <div className="notification-prompt">
      <Bell size={17} />
      <span>Get notified when a reminder is due.</span>
      {nativeLink ? (
        <a href={nativeLink}>Continue in Android</a>
      ) : (
        <button
          disabled={pending}
          onClick={() => {
            setPending(true);
            void enableDevicePush()
              .then((link) => {
                if (link) {
                  setNativeLink(link);
                  window.location.assign(link);
                } else setVisible(false);
              })
              .catch((error: Error) => toast.error(error.message))
              .finally(() => setPending(false));
          }}
        >
          Enable
        </button>
      )}
      <button
        disabled={pending}
        onClick={() => {
          sessionStorage.setItem("noted.notifications-later", "yes");
          setVisible(false);
        }}
      >
        Not now
      </button>
    </div>
  );
}
