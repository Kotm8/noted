import { Notice } from "../../../components/ui/notice";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { updatesApi } from "../api";
import type { AvailableRelease, UpdateStatus } from "../types";
import { serverUpdatesKey, useServerUpdates } from "../use-server-updates";

export function UpdatesPanel() {
  const query = useServerUpdates();
  const { refetch } = query;
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<AvailableRelease | null>(null);
  const [pendingCheck, setPendingCheck] = useState<{ previous: string | null } | null>(null);
  const check = useMutation({
    mutationFn: updatesApi.check,
    onSuccess: () => setPendingCheck({ previous: query.data?.last_checked ?? null }),
  });
  const apply = useMutation({
    mutationFn: updatesApi.apply,
    onSuccess: (job) => {
      client.setQueryData<UpdateStatus>(serverUpdatesKey, (current) =>
        current ? { ...current, job } : current,
      );
      setConfirmation(null);
    },
  });
  const data = query.data;
  const busy = data?.job?.status === "queued" || data?.job?.status === "running";
  const checking =
    !!pendingCheck &&
    data?.worker_online !== false &&
    (data?.last_checked ?? null) === pendingCheck.previous;

  useEffect(() => {
    if (!checking) return;
    const timer = window.setInterval(() => void refetch(), 2000);
    return () => window.clearInterval(timer);
  }, [checking, refetch]);

  if (!data)
    return (
      <div className="settings-section">
        <h3>Updates</h3>
        <Notice>
          {query.isError ? "Reconnecting to the update status..." : "Loading update status..."}
        </Notice>
      </div>
    );

  if (!data.configured)
    return (
      <div className="settings-section">
        <h3>Updates</h3>
        <p>Connect the server update worker to your GitHub repository during VPS setup.</p>
        {data.check_error && <Notice tone="error">{data.check_error}</Notice>}
      </div>
    );

  const downloaded = data.download_commit === data.latest?.commit;
  const error = apply.error ?? check.error;

  return (
    <div className="settings-section server-updates">
      <div className="updates-heading">
        <h3>Updates</h3>
        <span className="settings-hint">{data.installed?.version}</span>
      </div>
      <p>
        This server checks daily and downloads updates in the background. Install whenever you’re
        ready.
      </p>
      {!data.worker_online && (
        <Notice tone="warning">The update worker is offline. Check the VPS service.</Notice>
      )}
      {data.available && data.latest ? (
        <Notice>
          <div className="update-release">
            <strong>{data.latest.version} is available</strong>
            <span className="settings-hint">
              {downloaded && data.download_status === "ready"
                ? "Downloaded and ready to install"
                : downloaded && data.download_status === "downloading"
                  ? "Downloading in the background..."
                  : "The download will finish before installation"}
            </span>
            {data.latest.notes && <p className="update-notes">{data.latest.notes}</p>}
          </div>
        </Notice>
      ) : data.last_checked && !data.check_error ? (
        <p>{data.latest ? "You’re up to date." : "No updates have been published yet."}</p>
      ) : null}
      {data.job && (
        <Notice tone={data.job.status === "needs_recovery" ? "error" : "info"}>
          {data.job.detail}
          {busy && query.isError && " Reconnecting while the server restarts..."}
        </Notice>
      )}
      {(data.check_error || data.download_error || error) && (
        <Notice tone="error">{error?.message ?? data.check_error ?? data.download_error}</Notice>
      )}
      <div className="updates-actions">
        <Button
          variant="secondary"
          disabled={!data.worker_online || busy || check.isPending || checking}
          onClick={() => check.mutate()}
        >
          <RefreshCw size={15} />
          {checking || check.isPending ? "Checking..." : "Check for updates"}
        </Button>
        {data.available && data.latest && (
          <Button
            disabled={!data.worker_online || busy || data.job?.status === "needs_recovery"}
            onClick={() => {
              apply.reset();
              setConfirmation(data.latest);
            }}
          >
            <Download size={15} />
            Update server
          </Button>
        )}
        {data.job?.status === "succeeded" && (
          <Button onClick={() => window.location.reload()}>Reload app</Button>
        )}
      </div>
      {data.last_checked && (
        <small className="settings-hint">
          Last checked {new Date(data.last_checked).toLocaleString()}
        </small>
      )}
      <Modal
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !apply.isPending) setConfirmation(null);
        }}
        title="Update this server?"
        description={`Install ${confirmation?.version ?? "the available release"}. Notes will pause briefly while the server backs up your database and files, applies migrations, and restarts.`}
      >
        {apply.error && <Notice tone="error">{apply.error.message}</Notice>}
        <div className="updates-actions">
          <Button
            variant="secondary"
            disabled={apply.isPending}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </Button>
          <Button
            disabled={apply.isPending || !confirmation}
            onClick={() => confirmation && apply.mutate(confirmation)}
          >
            {apply.isPending ? "Starting..." : "Install update"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
