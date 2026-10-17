import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { AppProviders } from "./app/providers";
import { DesktopConnectionGate } from "./features/desktop/desktop-connection";
import "./styles.css";
import { initializeAndroidClient } from "./features/notifications/android";

initializeAndroidClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopConnectionGate>
      <AppProviders>
        <App />
      </AppProviders>
    </DesktopConnectionGate>
  </React.StrictMode>,
);
