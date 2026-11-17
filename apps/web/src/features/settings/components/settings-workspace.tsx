import { useEffect } from "react";
import { ArrowLeft, Settings } from "lucide-react";
import { ComicHalftone } from "../../../components/ui/comic-halftone";
import type { TrackingSection } from "../../time-tracking/components/tracking-settings";
import {
  SettingsContent,
  SettingsNavigation,
  type Section,
} from "./settings-sections";
import "../settings-workspace.css";

const sections: Section[] = [
  "appearance",
  "notifications",
  "tracking",
  "templates",
  "ai",
  "ai-prompts",
  "ai-history",
  "nutrition",
  "finance",
  "saved-meals",
  "server",
  "backups",
  "devices",
  "watch",
  "desktop",
];

export function SettingsWorkspace({
  path,
  onNavigate,
  onClose,
  trackingSection,
}: {
  path: string;
  onNavigate: (section: Section) => void;
  onClose: () => void;
  trackingSection?: TrackingSection;
}) {
  const section =
    sections.find((value) => value === path.split("/")[2]) ?? "appearance";
  useEffect(() => {
    const previous = document.title;
    document.title = "Settings \u00b7 Noted";
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <div className="settings-destination" role="region" aria-label="Settings">
      <aside className="settings-sidebar">
        <ComicHalftone />
        <div className="settings-sidebar-title">
          <Settings size={17} />
          Settings
        </div>
        <SettingsNavigation section={section} onSelect={onNavigate} />
        <button className="settings-return" onClick={onClose}>
          <ArrowLeft size={16} />
          Back to your space
        </button>
      </aside>
      <main className="settings-page">
        <header className="settings-page-header">
          <ComicHalftone />
          <Settings size={17} />
          Settings
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <ArrowLeft size={18} />
          </button>
        </header>
        <div
          className={`settings-content settings-page-content ${section === "appearance" ? "settings-wide" : ""}`}
          key={section}
        >
          <SettingsContent
            section={section}
            trackingSection={trackingSection}
            spacious
          />
        </div>
      </main>
    </div>
  );
}
