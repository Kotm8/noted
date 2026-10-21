import { useState } from "react";
import {
  Archive,
  Bell,
  Cable,
  LogOut,
  Monitor,
  Palette,
  Server,
  Timer,
  Watch,
} from "lucide-react";
import { ConnectionPanel } from "../../desktop/connection-panel";
import { isDesktop, useDesktopConnection } from "../../desktop/connection-context";
import { Modal } from "../../../components/ui/dialog";
import { useLogout } from "../../auth/hooks/use-logout";
import { AppearancePanel } from "./appearance-panel";
import { ServerPanel } from "./server-panel";
import { BackupsPanel } from "../../backups/components/backups-panel";
import { SessionsPanel } from "./sessions-panel";
import { NotificationsPanel } from "../../notifications/notifications-panel";
import { isAndroidApp } from "../../notifications/android";
import { SwitchServerButton } from "../../desktop/switch-server-button";
import { TrackingSettings } from "../../time-tracking/components/tracking-settings";
import type { TrackingTab } from "../../time-tracking/components/tracking-settings";
import { WatchPanel } from "../../wear/watch-panel";
import { DesktopUpdatesPanel } from "../../desktop/updates/desktop-updates-panel";

export function SettingsDialog({
  onClose,
  initialTab = "appearance",
  trackingTab,
}: {
  onClose: () => void;
  initialTab?: "appearance" | "tracking";
  trackingTab?: TrackingTab;
}) {
  const [tab, setTab] = useState<
    | "appearance"
    | "server"
    | "backups"
    | "sessions"
    | "connection"
    | "notifications"
    | "tracking"
    | "watch"
    | "desktop"
  >(initialTab);
  const connection = useDesktopConnection();
  const logout = useLogout();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="settings-dialog"
      title="Settings"
      description="Your account preferences and connected instance."
    >
      <div className="settings-layout">
        <nav className="settings-navigation" aria-label="Settings sections">
          <button
            aria-current={tab === "watch" ? "page" : undefined}
            onClick={() => setTab("watch")}
          >
            <Watch size={16} />
            Watch
          </button>
          <button
            aria-current={tab === "tracking" ? "page" : undefined}
            onClick={() => setTab("tracking")}
          >
            <Timer size={16} />
            Time tracking
          </button>
          <button
            aria-current={tab === "notifications" ? "page" : undefined}
            onClick={() => setTab("notifications")}
          >
            <Bell size={16} />
            Notifications
          </button>
          <button
            aria-current={tab === "appearance" ? "page" : undefined}
            onClick={() => setTab("appearance")}
          >
            <Palette size={16} />
            Appearance
          </button>
          <button
            aria-current={tab === "server" ? "page" : undefined}
            onClick={() => setTab("server")}
          >
            <Server size={16} />
            Server
          </button>
          <button
            aria-current={tab === "backups" ? "page" : undefined}
            onClick={() => setTab("backups")}
          >
            <Archive size={16} />
            Backups
          </button>
          <button
            aria-current={tab === "sessions" ? "page" : undefined}
            onClick={() => setTab("sessions")}
          >
            <Monitor size={16} />
            Sessions
          </button>
          {isDesktop && (
            <button aria-current={tab === "desktop" ? "page" : undefined} onClick={() => setTab("desktop")}>
              <Monitor size={16} />Desktop app
            </button>
          )}
          <button
            className="settings-signout"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut size={16} />
            Sign out
          </button>
          {connection && (
            <button
              aria-current={tab === "connection" ? "page" : undefined}
              onClick={() => setTab("connection")}
            >
              <Cable size={16} />
              Connection
            </button>
          )}
          {isAndroidApp() && <SwitchServerButton />}
        </nav>
        {tab === "desktop" ? (
          <DesktopUpdatesPanel />
        ) : tab === "watch" ? (
          <WatchPanel />
        ) : tab === "tracking" ? (
          <TrackingSettings initialTab={trackingTab} />
        ) : tab === "notifications" ? (
          <NotificationsPanel />
        ) : tab === "connection" ? (
          <ConnectionPanel />
        ) : tab === "appearance" ? (
          <AppearancePanel />
        ) : tab === "server" ? (
          <ServerPanel />
        ) : tab === "sessions" ? (
          <SessionsPanel />
        ) : (
          <BackupsPanel />
        )}
      </div>
    </Modal>
  );
}
