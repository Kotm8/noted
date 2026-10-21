import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { isDesktop } from "../connection-context";
import { DesktopUpdatesPanel } from "./desktop-updates-panel";
import { useDesktopUpdates } from "./use-desktop-updates";

export function DesktopUpdateNotice() {
  if (!isDesktop) return null;
  return <UpdateNotice />;
}

function UpdateNotice() {
  const { query } = useDesktopUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const data = query.data;
  const show =
    data?.supported &&
    data.latest_version &&
    data.latest_version !== dismissed &&
    ["available", "ready"].includes(data.phase);
  return (
    <>
      {show && !open && (
        <aside
          className="desktop-update-notice"
          aria-label="Desktop update available"
        >
          <Download size={16} />
          <span>
            Noted {data.latest_version}{" "}
            {data.phase === "ready" ? "is ready to install" : "is available"}
          </span>
          <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
            View update
          </Button>
          <button
            className="icon-button"
            aria-label="Dismiss desktop update"
            onClick={() => setDismissed(data.latest_version)}
          >
            <X size={15} />
          </button>
        </aside>
      )}
      {open && (
        <Modal
          open
          onOpenChange={setOpen}
          title="Desktop update"
          description="Update your installed Windows client."
        >
          <DesktopUpdatesPanel />
        </Modal>
      )}
    </>
  );
}
