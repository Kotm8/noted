import { useState, type ReactNode } from "react";
import {
  AppWindow,
  Archive,
  Bell,
  LogOut,
  Palette,
  Server,
  Smartphone,
  Timer,
  Watch,
} from "lucide-react";
import { isDesktop } from "../../desktop/connection-context";
import { Modal } from "../../../components/ui/dialog";
import { useLogout } from "../../auth/hooks/use-logout";
import { AppearancePanel } from "./appearance-panel";
import { ServerPanel } from "./server-panel";
import { BackupsPanel } from "../../backups/components/backups-panel";
import { NotificationsPanel } from "../../notifications/notifications-panel";
import { isAndroidApp } from "../../notifications/android";
import { SwitchServerButton } from "../../desktop/switch-server-button";
import { TrackingSettings } from "../../time-tracking/components/tracking-settings";
import type { TrackingSection } from "../../time-tracking/components/tracking-settings";
import { WatchAppearancePanel } from "../../wear/watch-panel";
import { DesktopAppPanel } from "../../desktop/desktop-app-panel";
import { DevicesPanel } from "./devices-panel";

type Section =
  | "appearance"
  | "notifications"
  | "tracking"
  | "server"
  | "backups"
  | "devices"
  | "watch"
  | "desktop";

export function SettingsDialog({
  onClose,
  initialTab = "appearance",
  trackingSection,
}: {
  onClose: () => void;
  initialTab?: "appearance" | "tracking";
  trackingSection?: TrackingSection;
}) {
  const [section, setSection] = useState<Section>(initialTab);
  const logout = useLogout();

  function item(
    value: Section,
    icon: ReactNode,
    label: string,
    nested = false,
  ) {
    return (
      <button
        className={nested ? "settings-nested" : undefined}
        aria-current={section === value ? "page" : undefined}
        onClick={() => setSection(value)}
      >
        {icon}
        {label}
      </button>
    );
  }

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
          {item("appearance", <Palette size={16} />, "Appearance")}
          {item("notifications", <Bell size={16} />, "Notifications")}
          {item("tracking", <Timer size={16} />, "Time tracking")}
          {item("server", <Server size={16} />, "Server")}
          {item("backups", <Archive size={16} />, "Backups")}
          {item("devices", <Smartphone size={16} />, "Devices")}
          {item("watch", <Watch size={16} />, "Watch appearance", true)}
          {isDesktop && item("desktop", <AppWindow size={16} />, "Desktop app")}
          <div className="settings-navigation-end">
            {isAndroidApp() && <SwitchServerButton />}
            <button
              className="settings-signout"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </nav>
        <div className="settings-content" key={section}>
          {section === "appearance" ? (
            <AppearancePanel />
          ) : section === "notifications" ? (
            <NotificationsPanel />
          ) : section === "tracking" ? (
            <TrackingSettings initialSection={trackingSection} />
          ) : section === "server" ? (
            <ServerPanel />
          ) : section === "backups" ? (
            <BackupsPanel />
          ) : section === "devices" ? (
            <DevicesPanel />
          ) : section === "watch" ? (
            <WatchAppearancePanel />
          ) : (
            <DesktopAppPanel />
          )}
        </div>
      </div>
    </Modal>
  );
}
