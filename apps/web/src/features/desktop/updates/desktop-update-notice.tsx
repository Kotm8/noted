import { useState, type CSSProperties } from "react";
import { Download, LoaderCircle, RotateCw, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { readStoredValue, writeStoredValue } from "../../../lib/storage";
import { Markdown } from "../../notes/components/markdown";
import { isDesktop } from "../connection-context";
import { useDesktopUpdates } from "./use-desktop-updates";

const SKIPPED_KEY = "noted.desktop.skippedVersion";

export function DesktopUpdateNotice() {
  if (!isDesktop) return null;
  return <UpdateNotice />;
}

/**
 * One click downloads the signed update with its progress shown in place,
 * then one more restarts into it. "Later" lasts until Noted restarts;
 * "Skip this version" lasts until a newer one is out.
 */
function UpdateNotice() {
  const { query, action } = useDesktopUpdates();
  const [later, setLater] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => readStoredValue(SKIPPED_KEY));
  const [notes, setNotes] = useState(false);
  const data = query.data;
  const version = data?.latest_version;
  const phase = data?.phase;
  const active =
    phase === "downloading" || phase === "ready" || phase === "installing";
  if (
    !data?.supported ||
    !version ||
    !(active || phase === "available" || phase === "error") ||
    (!active && (version === later || version === skipped))
  )
    return null;

  const progress =
    phase === "downloading" && data.total_bytes
      ? Math.round((data.downloaded_bytes / data.total_bytes) * 100)
      : null;
  const busy =
    action.isPending || phase === "downloading" || phase === "installing";
  const message =
    phase === "downloading"
      ? `Downloading Noted ${version}${progress === null ? "…" : ` · ${progress}%`}`
      : phase === "ready"
        ? `Noted ${version} is ready`
        : phase === "installing"
          ? "Starting the installer…"
          : phase === "error"
            ? (data.error ?? "The update didn't finish.")
            : `Noted ${version} is available`;

  return (
    <>
      <aside
        className="desktop-update-notice"
        aria-label="Desktop update"
        style={
          progress === null
            ? undefined
            : ({ "--update-progress": `${progress}%` } as CSSProperties)
        }
        data-phase={phase}
      >
        {busy ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <Download size={16} />
        )}
        <span role="status">{message}</span>
        {data.notes && phase !== "installing" && (
          <Button variant="ghost" size="small" onClick={() => setNotes(true)}>
            What's new
          </Button>
        )}
        {phase === "ready" ? (
          <Button
            size="small"
            disabled={busy}
            onClick={() => action.mutate("install")}
          >
            <RotateCw size={14} />
            Restart to update
          </Button>
        ) : phase === "available" || phase === "error" ? (
          <Button
            size="small"
            disabled={busy}
            onClick={() => action.mutate("download")}
          >
            {phase === "error" ? "Try again" : "Update"}
          </Button>
        ) : null}
        {!active && (
          <button
            className="icon-button"
            aria-label="Remind me later"
            title="Remind me later"
            onClick={() => setLater(version)}
          >
            <X size={15} />
          </button>
        )}
      </aside>
      {notes && (
        <Modal
          open
          onOpenChange={setNotes}
          title={`What's new in Noted ${version}`}
          description={`You have ${data.current_version}. The update is signed and checked before it installs.`}
        >
          <div className="desktop-update-notes">
            <Markdown content={data.notes ?? ""} />
          </div>
          <div className="dialog-actions">
            {!active && (
              <Button
                variant="ghost"
                onClick={() => {
                  writeStoredValue(SKIPPED_KEY, version);
                  setSkipped(version);
                  setNotes(false);
                }}
              >
                Skip this version
              </Button>
            )}
            <Button variant="secondary" onClick={() => setNotes(false)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
