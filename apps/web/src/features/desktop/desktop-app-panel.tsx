import { ConnectionPanel } from "./connection-panel";
import { DesktopUpdatesPanel } from "./updates/desktop-updates-panel";
import { StartupSettings } from "./startup/startup-settings";

export function DesktopAppPanel() {
  return (
    <section className="settings-panel">
      <h2>Desktop app</h2>
      <p>How this Windows app connects, starts, and updates.</p>
      <ConnectionPanel />
      <StartupSettings />
      <DesktopUpdatesPanel />
    </section>
  );
}
