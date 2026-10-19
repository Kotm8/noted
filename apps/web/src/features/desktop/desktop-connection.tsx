import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { AuthBrand } from "../auth/components/auth-brand";
import { DesktopConnectionContext, isDesktop } from "./connection-context";
import { desktopRequest } from "./desktop-request";
import { DesktopSetup } from "../installer/desktop-setup";
import type { InstallationJob } from "../installer/desktop-types";
import "../../styles/desktop.css";
import { ConnectionScreen } from "../../components/connection-screen";
import { finishStartup } from "../../lib/startup";

interface Profile {
  serverUrl: string | null;
}

async function connectionRequest(
  method = "GET",
  serverUrl?: string,
): Promise<Profile> {
  return desktopRequest<Profile>(
    "connection",
    method,
    method === "PUT" ? { serverUrl } : undefined,
  );
}

export function DesktopConnectionGate({ children }: { children: ReactNode }) {
  if (!isDesktop) return children;
  return <DesktopConnection>{children}</DesktopConnection>;
}

function DesktopConnection({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [job, setJob] = useState<InstallationJob | null>(null);
  useEffect(() => {
    if (error || (profile && !profile.serverUrl)) finishStartup();
  }, [profile, error]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      connectionRequest(),
      desktopRequest<InstallationJob>("setup"),
    ])
      .then(([connection, installation]) => {
        if (mounted) {
          setProfile(connection);
          setJob(installation);
          if (
            !connection.serverUrl &&
            ["running", "waiting_dns"].includes(installation.status)
          )
            setSetup(true);
        }
      })
      .catch((failure: Error) => {
        if (mounted) setError(failure.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setProfile(await connectionRequest("PUT", address.trim()));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not connect.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchServer() {
    const next = await connectionRequest("DELETE");
    setAddress(profile?.serverUrl ?? "");
    setProfile(next);
  }

  async function openSetup() {
    setBusy(true);
    setError(null);
    try {
      setJob(await desktopRequest<InstallationJob>("setup"));
      setSetup(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not open setup.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!profile && !error) return <ConnectionScreen />;

  if (setup) {
    return (
      <DesktopSetup
        initialJob={job}
        close={() => setSetup(false)}
        connected={async () => {
          setProfile(await connectionRequest());
          setSetup(false);
        }}
      />
    );
  }

  if (profile?.serverUrl) {
    return (
      <DesktopConnectionContext.Provider
        value={{ serverUrl: profile.serverUrl, switchServer }}
      >
        {children}
      </DesktopConnectionContext.Provider>
    );
  }

  return (
    <main className="auth-screen">
      <AuthBrand />
      <form
        className="auth-form auth-form-section"
        onSubmit={(event) => {
          void connect(event);
        }}
      >
        <h2>Connect to your server.</h2>
        <p className="form-intro">
          Enter your Noted address. You will sign in next.
        </p>
        <label>
          Server address
          <input
            type="url"
            autoFocus
            required
            maxLength={2048}
            autoComplete="url"
            placeholder="https://notes.example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={busy}
          />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button
          className="auth-submit"
          type="submit"
          disabled={busy || !address.trim()}
        >
          {busy ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <ArrowRight size={16} />
          )}
          {busy ? "Connecting..." : "Connect"}
        </Button>
        <Button
          className="auth-submit desktop-setup-button"
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            void openSetup();
          }}
        >
          {job?.plan && job.status !== "complete"
            ? "Continue server setup"
            : "Set up a new server"}
        </Button>
      </form>
      <p className="auth-footer">
        Your notes stay on your server. Only the server address is saved here.
      </p>
    </main>
  );
}
