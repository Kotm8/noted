import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { AppProviders } from "./app/providers";
import { DesktopConnectionGate } from "./features/desktop/desktop-connection";
import { AndroidPilotConnection } from "./features/android-pilot/connection";
import { isAndroidPilot } from "./lib/android-pilot";
import "./styles.css";
import { initializeAndroidClient } from "./features/notifications/android";
import { retireBrowserPush } from "./features/notifications/retire-browser-push";
import { initializeAndroidNavigation } from "./lib/android-navigation";

void retireBrowserPush().catch(() => {});

initializeAndroidClient();
initializeAndroidNavigation();

const app = (
  <AppProviders>
    <App />
  </AppProviders>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isAndroidPilot ? (
      <AndroidPilotConnection>{app}</AndroidPilotConnection>
    ) : (
      <DesktopConnectionGate>{app}</DesktopConnectionGate>
    )}
  </React.StrictMode>,
);
