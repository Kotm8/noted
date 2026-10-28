import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { useDesktopConnection } from "./connection-context";

export function ConnectionPanel() {
  const connection = useDesktopConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!connection) return null;

  async function disconnect() {
    setBusy(true);
    setError(null);
    try { await connection!.switchServer(); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not switch servers.");
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3>Connection</h3>
      <p>This app connects to this Noted server.</p>
      <p className="desktop-server-address">{connection.serverUrl}</p>
      <p className="settings-hint">The server address is remembered. Sign in again after restarting the app.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="secondary" disabled={busy} onClick={() => { void disconnect(); }}>
        Switch server
      </Button>
    </section>
  );
}
