import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, Smartphone, Watch } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import {
  devicesApi,
  devicesKey,
  type Device,
  type DeviceKind,
  type ReleaseTarget,
} from "./api";
import { ConnectDialog } from "./connect-dialog";
import { InstallDialog } from "./install-dialog";
import "../../../styles/devices.css";

type Open =
  | { type: "connect"; kind: DeviceKind }
  | { type: "install"; device: Device }
  | null;

function DeviceCard({
  kind,
  device,
  version,
  busy,
  onConnect,
  onInstall,
  onForget,
}: {
  kind: DeviceKind;
  device: Device | undefined;
  version: string | null;
  busy: boolean;
  onConnect: () => void;
  onInstall: (device: Device) => void;
  onForget: (device: Device) => void;
}) {
  const label = kind === "phone" ? "Phone" : "Watch";
  let status: ReactNode;
  let action: ReactNode;
  if (!device) {
    status = `Not connected. ${kind === "phone" ? "Connect by USB cable or Wi-Fi." : "Connect over Wi-Fi."}`;
    action = (
      <Button type="button" disabled={busy} onClick={onConnect}>
        Connect
      </Button>
    );
  } else {
    const via = device.connection === "usb" ? "USB" : "Wi-Fi";
    const upToDate = device.installed !== null && device.installed === version;
    status = (
      <>
        {device.name} · {via} ·{" "}
        {!device.connected ? (
          <span className="device-status-muted">not reachable right now</span>
        ) : device.installed === null ? (
          <span className="device-status-update">Noted isn't installed</span>
        ) : upToDate ? (
          <span className="device-status-ok">
            Noted {device.installed} · up to date
          </span>
        ) : (
          <>
            Noted {device.installed} ·{" "}
            <span className="device-status-update">Update available</span>
          </>
        )}
      </>
    );
    action = (
      <>
        <Button
          type="button"
          variant={upToDate ? "ghost" : "default"}
          disabled={busy || !version}
          onClick={() => onInstall(device)}
        >
          {upToDate
            ? "Reinstall"
            : device.installed && device.connected
              ? `Update to ${version ?? ""}`
              : `Install ${version ?? ""}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onForget(device)}
        >
          Forget
        </Button>
      </>
    );
  }
  return (
    <article className="device-card">
      <span className="device-icon">
        {kind === "phone" ? <Smartphone size={22} /> : <Watch size={22} />}
      </span>
      <div>
        <h3>{label}</h3>
        <p>{status}</p>
      </div>
      <div className="device-actions">{action}</div>
    </article>
  );
}

/**
 * Phone and watch cards with connect and install flows. The wizard passes the
 * release it is about to install; Settings uses the connected server's version.
 */
export function DevicesSection({
  target,
  showTool = true,
}: {
  target?: ReleaseTarget;
  showTool?: boolean;
}) {
  const client = useQueryClient();
  const overview = useQuery({
    queryKey: devicesKey,
    queryFn: devicesApi.overview,
  });
  const [open, setOpen] = useState<Open>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: devicesKey });
  const tool = useMutation({
    mutationFn: devicesApi.downloadTool,
    onSuccess: refresh,
  });
  const forget = useMutation({
    mutationFn: (device: Device) => devicesApi.forget(device.id),
    onSuccess: refresh,
  });
  const data = overview.data;
  const version = target?.version ?? data?.serverVersion ?? null;
  const ready = data?.tool.ready ?? false;

  /** Connecting needs the install tool, so fetch it first when it's missing. */
  async function connect(kind: DeviceKind) {
    if (!ready) await tool.mutateAsync();
    setOpen({ type: "connect", kind });
  }

  const deviceOf = (kind: DeviceKind) =>
    data?.devices.find((device) => device.kind === kind);
  const watch = deviceOf("watch");

  return (
    <div className="devices-section">
      {data && showTool && (
        <div className="device-tool">
          <span className={ready ? "device-dot" : "device-dot missing"} />
          {ready ? (
            <span>
              Install tool ready
              {data.tool.source === "existing"
                ? " · using the Android SDK on this PC"
                : ""}
            </span>
          ) : (
            <>
              <span>
                Install tool not downloaded yet · about 7 MB from Google
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={tool.isPending}
                onClick={() => tool.mutate()}
              >
                {tool.isPending ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Download size={14} />
                )}
                {tool.isPending ? "Downloading…" : "Download"}
              </Button>
            </>
          )}
        </div>
      )}
      {!version && data && (
        <Notice>
          Connect to your Noted server to see which version to install.
        </Notice>
      )}
      {(overview.error || tool.error || forget.error) && (
        <Notice tone="error">
          {(overview.error ?? tool.error ?? forget.error)?.message}
        </Notice>
      )}
      {overview.isPending && <p role="status">Checking for devices…</p>}
      {data && (
        <div className="device-cards">
          {(["phone", "watch"] as const).map((kind) => (
            <DeviceCard
              key={kind}
              kind={kind}
              device={deviceOf(kind)}
              version={version}
              busy={tool.isPending || forget.isPending}
              onConnect={() => void connect(kind).catch(() => undefined)}
              onInstall={(device) => setOpen({ type: "install", device })}
              onForget={(device) => forget.mutate(device)}
            />
          ))}
        </div>
      )}
      {open?.type === "connect" && (
        <ConnectDialog
          kind={open.kind}
          version={version}
          onClose={() => {
            setOpen(null);
            refresh();
          }}
          onInstall={(device) => setOpen({ type: "install", device })}
        />
      )}
      {open?.type === "install" && (
        <InstallDialog
          device={open.device}
          commit={target?.commit}
          version={version}
          onClose={() => {
            setOpen(null);
            refresh();
          }}
          onPairAgain={() =>
            setOpen({ type: "connect", kind: open.device.kind })
          }
          onNext={
            open.device.kind === "phone" && watch?.installed !== version
              ? () => void connect("watch").catch(() => undefined)
              : undefined
          }
        />
      )}
    </div>
  );
}
