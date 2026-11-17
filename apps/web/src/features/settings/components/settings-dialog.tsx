import { useState } from "react";
import { Modal } from "../../../components/ui/dialog";
import type { TrackingSection } from "../../time-tracking/components/tracking-settings";
import {
  SettingsNavigation,
  SettingsContent,
  type Section,
} from "./settings-sections";
export type { Section } from "./settings-sections";

export function SettingsDialog({
  onClose,
  initialTab = "appearance",
  trackingSection,
}: {
  onClose: () => void;
  initialTab?: Section;
  trackingSection?: TrackingSection;
}) {
  const [section, setSection] = useState<Section>(initialTab);
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
        <SettingsNavigation section={section} onSelect={setSection} />
        <div className="settings-content" key={section}>
          <SettingsContent
            section={section}
            trackingSection={trackingSection}
          />
        </div>
      </div>
    </Modal>
  );
}
