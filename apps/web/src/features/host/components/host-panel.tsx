import { Notice } from "../../../components/ui/notice";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft, Globe } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { hostApi } from "../api";
import type { HostJob, HostStatus } from "../types";
import { hostKey, useHost } from "../use-host";
import { DomainDialog } from "./domain-dialog";
import { RemoveServerDialog } from "./remove-server-dialog";
import { TransferDialog } from "./transfer-dialog";

export function HostPanel({
  ownerUsername,
  instance,
}: {
  ownerUsername: string;
  instance: string;
}) {
  const query = useHost();
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"transfer" | "domain" | "remove" | null>(null);
  const [cancelPassword, setCancelPassword] = useState("");
  const [destination, setDestination] = useState<string | null>(null);
  const updateJob = (job: HostJob) => {
    client.setQueryData<HostStatus>(hostKey, (current) =>
      current ? { ...current, job } : current,
    );
    if (job.destination) setDestination(job.destination);
  };
  const cancel = useMutation({
    mutationFn: hostApi.cancel,
    onSuccess: (job) => {
      setCancelPassword("");
      updateJob(job);
    },
  });
  const data = query.data;
  const job = data?.job ?? null;
  const busy = !!job && ["queued", "running", "waiting_dns", "needs_recovery"].includes(job.status);
  const ready = !!data?.capable && data.worker_online && !busy;
  const nextAddress = job?.destination ?? destination;
  return (
    <>
      <div className="settings-section host-panel">
        <h3>Hosting</h3>
        {!data?.capable && (
          <p>
            Connect version 2 or later of the VPS worker to enable SSH transfer, domain changes, and
            server removal.
          </p>
        )}
        {data?.capable && !data.worker_online && (
          <Notice tone="warning">The host worker is offline.</Notice>
        )}
        <div className="host-actions">
          <Button variant="secondary" disabled={!ready} onClick={() => setDialog("transfer")}>
            <ArrowRightLeft size={15} />
            Transfer VPS
          </Button>
          <Button variant="secondary" disabled={!ready} onClick={() => setDialog("domain")}>
            <Globe size={15} />
            Switch domain
          </Button>
        </div>
        {job && job.action !== "probe" && (
          <div className="host-progress">
            <strong>
              {job.action === "transfer"
                ? "VPS transfer"
                : job.action === "domain"
                  ? "Domain change"
                  : "Server operation"}
            </strong>
            <Notice
              tone={job.status === "failed" || job.status === "needs_recovery" ? "error" : "info"}
            >
              {job.detail}
            </Notice>
            {query.isError && busy && (
              <Notice>Reconnecting while the server is paused or restarting...</Notice>
            )}
            {job.ip && (
              <p>
                Destination IP: <code>{job.ip}</code>
              </p>
            )}
          </div>
        )}
        {nextAddress && (
          <a className="host-destination" href={nextAddress} target="_blank" rel="noreferrer">
            Open {nextAddress}
          </a>
        )}
        {job?.status === "waiting_dns" && (
          <div className="transfer-dns">
            <p>
              Update your existing Cloudflare DNS record to <strong>{job.ip}</strong>. Keep the
              hostname unchanged. Prefer DNS only until HTTPS is verified.
            </p>
            <details>
              <summary>Cancel transfer and restore source writes</summary>
              <p>This retains the destination copy. Use only one copy after cancelling.</p>
              <label>
                Current owner password
                <input
                  type="password"
                  value={cancelPassword}
                  onChange={(event) => setCancelPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <Button
                variant="secondary"
                disabled={!cancelPassword || cancel.isPending}
                onClick={() => cancel.mutate({ current_password: cancelPassword })}
              >
                Cancel transfer
              </Button>
              {cancel.error && <Notice tone="error">{cancel.error.message}</Notice>}
            </details>
          </div>
        )}
      </div>
      <div className="danger-zone">
        <div className="danger-zone-title">
          <AlertTriangle size={18} />
          <h3>Danger Zone</h3>
        </div>
        <strong>Permanently delete this Noted server</strong>
        <p>
          Delete Noted, its account, notes, uploads, backups, and private volumes from this VPS.
          This cannot be undone. The VPS operating system and other apps remain.
        </p>
        <Button variant="danger" disabled={!ready} onClick={() => setDialog("remove")}>
          Delete Noted from this VPS
        </Button>
      </div>
      {dialog === "transfer" && (
        <TransferDialog
          ownerUsername={ownerUsername}
          job={job}
          onQueued={updateJob}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "domain" && <DomainDialog onQueued={updateJob} onClose={() => setDialog(null)} />}
      {dialog === "remove" && data && (
        <RemoveServerDialog
          instance={instance}
          instanceId={data.instance_id}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
