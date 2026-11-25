import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { Modal } from "../../components/ui/dialog";
import { useDesktopConnection } from "./connection-context";
import { androidPilot, isAndroidPilot } from "../../lib/android-pilot";
import {
  androidConnectionUrl,
  disconnectAndroid,
  isAndroidApp,
} from "../notifications/android";

export function SwitchServerButton() {
  return isAndroidPilot ? <PilotSwitchServerButton /> : <SwitchServerControl />;
}

function PilotSwitchServerButton() {
  const [open, setOpen] = useState(false);
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
      <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
        Switch server
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
        title="Switch server"
        description="Drafts and queued notes stay with the server where you wrote them."
      >
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              await androidPilot.connect({ server: server.trim() });
              window.location.replace("/");
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Couldn't reach that Noted server.",
              );
              setBusy(false);
            }
          }}
        >
          <label>
            Server address
            <input
              inputMode="url"
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="notes.example.com"
              required
              maxLength={2048}
              disabled={busy}
              value={server}
              onChange={(event) => setServer(event.target.value)}
            />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" disabled={busy || !server.trim()}>
            {busy ? "Connecting..." : "Connect"}
          </Button>
        </form>
      </Modal>
    </>
  );
}

function SwitchServerControl() {
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
      } else await connection!.switchServer();
      setBusy(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not switch servers.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="desktop-switch-server">
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        variant="ghost"
        size="small"
        disabled={busy}
        onClick={() => {
          void disconnect();
        }}
      >
        Switch server
      </Button>
    </div>
  );
}
