import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { CopyBox } from "../../components/ui/copy-box";
import { Notice } from "../../components/ui/notice";
import { generatedDomain, isGeneratedDomain } from "../../lib/generated-domain";
import type { HostIdentity } from "../installer/desktop-types";
import { useDesktopConnection } from "./connection-context";
import { desktopRequest } from "./desktop-request";

/**
 * A server without a domain is reached at an address made from its IP, so when
 * the IP changes Noted can't be reached to fix it from inside. The desktop app
 * fixes it over SSH instead, then reconnects to the new address.
 */
export function ServerAddressPanel() {
  const connection = useDesktopConnection();
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("22");
  const [identity, setIdentity] = useState<HostIdentity | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"key" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!connection || !isGeneratedDomain(connection.serverUrl)) return null;

  function reset() {
    setIdentity(null);
    setTrusted(false);
    setError(null);
  }

  async function readKey() {
    setBusy("key");
    setError(null);
    try {
      setIdentity(
        await desktopRequest<HostIdentity>("setup/host", "POST", {
          ip: ip.trim(),
          port: Number(port),
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function update() {
    setBusy("switch");
    setError(null);
    try {
      const { serverUrl } = await desktopRequest<{ serverUrl: string }>(
        "server-address",
        "POST",
        {
          ip: ip.trim(),
          port: Number(port),
          hostKey: identity!.hostKey,
          password,
        },
      );
      await desktopRequest("connection", "PUT", { serverUrl });
      window.location.reload();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(null);
    }
  }

  return (
    <section className="server-address-panel">
      <h3>My server's IP changed</h3>
      <p>
        Your address is made from your server's IP, so it stops working if the
        IP changes. Enter the new IP, and Noted updates the address on the
        server over SSH, then reconnects this app.
      </p>
      <div className="server-address-fields">
        <label>
          New server IP
          <input
            value={ip}
            placeholder="198.51.100.7"
            autoComplete="off"
            onChange={(event) => {
              setIp(event.target.value);
              reset();
            }}
          />
        </label>
        <label>
          SSH port
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
              reset();
            }}
          />
        </label>
      </div>
      {ip.trim() && (
        <div className="server-address-new">
          <span>New address</span>
          <CopyBox value={`https://${generatedDomain(ip)}`} />
        </div>
      )}
      {!identity ? (
        <Button
          type="button"
          variant="ghost"
          disabled={!ip.trim() || !port || busy !== null}
          onClick={() => void readKey()}
        >
          {busy === "key" && <LoaderCircle size={15} className="spin" />}
          Read SSH host key
        </Button>
      ) : (
        <>
          <div className="server-address-key">
            <code>{identity.fingerprint}</code>
            <label className="check-label">
              <input
                type="checkbox"
                checked={trusted}
                onChange={(event) => setTrusted(event.target.checked)}
              />
              This fingerprint matches my server.
            </label>
          </div>
          <label>
            Root SSH password
            <input
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={!trusted || !password || busy !== null}
            onClick={() => void update()}
          >
            {busy === "switch" && <LoaderCircle size={15} className="spin" />}
            {busy === "switch" ? "Updating the address…" : "Update address"}
          </Button>
          {busy === "switch" && (
            <p className="settings-hint">
              This can take a few minutes while the server gets a certificate
              for the new address.
            </p>
          )}
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
