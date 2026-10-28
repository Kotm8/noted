import { isDesktop } from "../../desktop/connection-context";
import { DevicesSection } from "../../desktop/devices/devices-section";
import { WatchPairing } from "../../wear/watch-panel";

export function DevicesPanel() {
  return (
    <section className="settings-panel">
      <h2>Devices</h2>
      <p>Your phone and watch. Watch appearance has its own page below.</p>
      {isDesktop && (
        <section className="settings-section">
          <h3>Install the apps</h3>
          <p>
            Install and update the Noted app on your phone and watch from this
            PC. They always get the version your server runs, downloaded from
            its GitHub release to a temporary folder and deleted after
            installing.
          </p>
          <DevicesSection />
        </section>
      )}
      <WatchPairing />
    </section>
  );
}
