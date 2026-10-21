import { useState } from "react";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { Markdown } from "../../notes/components/markdown";
import { useDesktopUpdates } from "./use-desktop-updates";

export function DesktopUpdatesPanel() {
  const { query, action } = useDesktopUpdates();
  const [confirm, setConfirm] = useState(false);
  const data = query.data;
  const busy =
    action.isPending ||
    ["checking", "downloading", "installing"].includes(data?.phase ?? "");
  const error = action.error?.message ?? query.error?.message ?? data?.error;

  return (
    <section className="settings-panel desktop-updates-panel">
      <h2>Desktop app</h2>
      <p>
        Noted checks for updates when it starts and every day while open. You
        choose when to download and install.
      </p>
      {data && (
        <p className="settings-hint">
          Installed version: {data.current_version}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {query.isPending && <p role="status">Loading desktop update status...</p>}
      {data?.supported === false && (
        <Notice>Automatic desktop updates are available on Windows.</Notice>
      )}
      {data?.supported && (
        <>
          <p role="status">
            {data.phase === "checking"
              ? "Checking for updates..."
              : data.phase === "downloading"
                ? "Downloading and verifying the update..."
                : data.phase === "installing"
                  ? "Starting the installer..."
                  : data.phase === "ready"
                    ? `Noted ${data.latest_version} is downloaded and verified.`
                    : data.latest_version
                      ? `Noted ${data.latest_version} is available.`
                      : data.checked_at
                        ? "You have the latest version."
                        : "Check for a newer version of Noted."}
          </p>
          {data.phase === "downloading" && (
            <progress
              aria-label="Desktop update download"
              max={data.total_bytes ?? 1}
              value={data.total_bytes ? data.downloaded_bytes : undefined}
            />
          )}
          {data.phase === "ready" && (
            <Notice>
              The update signature is verified. Save any work before restarting.
            </Notice>
          )}
          <div className="desktop-update-actions">
            <Button
              variant="secondary"
              disabled={busy || data.phase === "ready"}
              onClick={() => action.mutate("check")}
            >
              <RefreshCw size={15} />
              Check for updates
            </Button>
            {data.latest_version && data.phase !== "ready" && (
              <Button disabled={busy} onClick={() => action.mutate("download")}>
                <Download size={15} />
                Download update
              </Button>
            )}
            {data.phase === "ready" && (
              <Button disabled={busy} onClick={() => setConfirm(true)}>
                <RotateCw size={15} />
                Restart and install
              </Button>
            )}
          </div>
          {data.checked_at && (
            <p className="settings-hint">
              Last checked: {new Date(data.checked_at * 1000).toLocaleString()}
            </p>
          )}
          {data.notes && (
            <div className="desktop-update-notes">
              <h3>What changed</h3>
              <Markdown content={data.notes} />
            </div>
          )}
        </>
      )}
      {confirm && (
        <Modal
          open
          onOpenChange={setConfirm}
          title="Install desktop update?"
          description={`Noted will close to install version ${data?.latest_version}. Save any work before continuing.`}
        >
          <div className="desktop-update-actions">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep working
            </Button>
            <Button
              onClick={() => {
                setConfirm(false);
                action.mutate("install");
              }}
            >
              Restart and install
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
