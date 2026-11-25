import { useEffect } from "react";
import { toast } from "sonner";
import { androidPilot, isAndroidPilot } from "../lib/android-pilot";

export function AndroidTransferProgress() {
  useEffect(() => {
    if (!isAndroidPilot) return;
    const visible = new Set<string>();
    let active = true;
    const listener = androidPilot.addListener(
      "transferProgress",
      (transfer) => {
        if (!active) return;
        const { id, direction } = transfer;
        if (transfer.done) {
          if (visible.delete(id)) toast.dismiss(id);
          return;
        }
        const { bytes, total } = transfer;
        const percentage = total > 0 ? Math.floor((100 * bytes) / total) : 100;
        const label =
          direction === "upload" ? "Uploading files" : "Saving attachment";
        visible.add(id);
        toast(
          <div style={{ width: "100%", minWidth: "160px" }}>
            <div>
              {label} · {percentage}%
            </div>
            <progress
              aria-label={label}
              value={percentage}
              max={100}
              style={{ accentColor: "var(--accent)", width: "100%" }}
            />
          </div>,
          { id, duration: Infinity },
        );
      },
    );
    void listener.catch(() => {});
    return () => {
      active = false;
      visible.forEach((id) => toast.dismiss(id));
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
  return null;
}
