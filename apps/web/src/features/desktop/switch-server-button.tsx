import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { useDesktopConnection } from "./connection-context";
import { androidConnectionUrl, disconnectAndroid, isAndroidApp } from "../notifications/android";

export function SwitchServerButton() {
  const connection = useDesktopConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!connection && !isAndroidApp()) return null;

  async function disconnect() {
    setBusy(true);
    try {
      if (isAndroidApp()) {
        await disconnectAndroid();
        window.location.assign(androidConnectionUrl);
      }
      else await connection!.switchServer();
      setBusy(false);
    }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not switch servers.");
      setBusy(false);
    }
  }

  return (
    <div className="desktop-switch-server">
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" size="small" disabled={busy} onClick={() => { void disconnect(); }}>
        Switch server
      </Button>
    </div>
  );
}
