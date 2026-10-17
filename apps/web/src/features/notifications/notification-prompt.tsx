import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { enablePush, pushPermission, registerPush, supportsPush } from "./browser";

export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true;
    const reconnect = async () => {
      if (!supportsPush() || localStorage.getItem("noted.push-disabled") === "yes") return;
      const permission = await pushPermission();
      if (active) setVisible(permission === "default" && sessionStorage.getItem("noted.notifications-later") !== "yes");
      if (permission === "granted") await registerPush();
    };
    const resume = () => { void reconnect().catch(() => toast.error("Could not reconnect notifications. Try enabling them in Settings.")); };
    resume();
    window.addEventListener("focus", resume);
    return () => { active = false; window.removeEventListener("focus", resume); };
  }, []);
  if (!visible) return null;
  return (
    <div className="notification-prompt">
      <Bell size={17} />
      <span>Get notified when a reminder is due.</span>
      <button
        disabled={pending}
        onClick={() => {
          setPending(true);
          void enablePush()
            .then(() => setVisible(false))
            .catch((error: Error) => toast.error(error.message))
            .finally(() => setPending(false));
        }}
      >
        Enable
      </button>
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
