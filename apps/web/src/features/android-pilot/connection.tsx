import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ConnectionScreen } from "../../components/connection-screen";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { androidPilot, PilotOriginContext } from "../../lib/android-pilot";
import { finishStartup } from "../../lib/startup";
import { AuthBrand } from "../auth/components/auth-brand";

export function AndroidPilotConnection({ children }: { children: ReactNode }) {
  const [server, setServer] = useState<string | null>();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void androidPilot.profile().then(
      (profile) => {
        if (active) setServer(profile.server);
      },
      () => {
        if (!active) return;
        setError("Couldn't read the Android connection settings.");
        setServer(null);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (server === null) finishStartup();
  }, [server]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const profile = await androidPilot.connect({ server: address.trim() });
      setServer(profile.server);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't connect to Noted.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (server === undefined) return <ConnectionScreen />;
  if (server)
    return (
      <PilotOriginContext.Provider key={server} value={server}>
        {children}
      </PilotOriginContext.Provider>
    );
  return (
    <main className="auth-screen">
      <AuthBrand />
      <form
        className="auth-form auth-form-section"
        onSubmit={(event) => void connect(event)}
      >
        <h2>Connect to your server</h2>
        <label>
          Server address
          <input
            type="text"
            inputMode="url"
            required
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={2048}
            placeholder="notes.example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={busy}
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy || !address.trim()}>
          {busy ? "Connecting..." : "Connect"}
        </Button>
      </form>
    </main>
  );
}
