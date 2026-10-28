import { useState, type FormEvent } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { Notice } from "../../../components/ui/notice";
import { desktopRequest } from "../../desktop/desktop-request";
import type { InstallationJob, InstallationPlan } from "../desktop-types";

interface Inspection {
  present: boolean;
  serverName: string;
  domain: string;
  snapshot: string;
  containerCount: number;
  volumeCount: number;
}

export function CleanupDialog({
  plan,
  close,
  started,
}: {
  plan: InstallationPlan;
  close: () => void;
  started: (job: InstallationJob) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect() {
    setBusy(true);
    setError(null);
    setInspection(null);
    setConfirmation("");
    setAcknowledged(false);
    try {
      setInspection(
        await desktopRequest<Inspection>("setup/cleanup/inspect", "POST", {
          sshPassword: password,
        }),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not inspect the installation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy ||
      !inspection ||
      !acknowledged ||
      confirmation !== "I LOVE VERITY"
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const result = await desktopRequest<InstallationJob>(
        "setup/cleanup",
        "POST",
        {
          sshPassword: password,
          confirmation,
          snapshot: inspection.snapshot,
        },
      );
      if (result.status !== "running")
        throw new Error("The client did not start cleanup.");
      setPassword("");
      started(result);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Cleanup could not finish.",
      );
      setInspection(null);
      setConfirmation("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title="Clean Noted from this VPS"
      description={`Permanently remove Noted from ${plan.host.ip}:${plan.host.port}.`}
      className="host-dialog"
    >
      <form
        className="host-form"
        onSubmit={(event) => {
          void remove(event);
        }}
      >
        <Notice tone="warning">
          <strong>
            All Noted data on this VPS will be permanently deleted.
          </strong>
          <p>
            This includes accounts, projects, channels, messages, uploads,
            server-side backups, and the update worker. Download any backup you
            need before continuing.
          </p>
          <p>
            Amnezia, other apps, Docker, and the VPS operating system stay
            installed.
          </p>
        </Notice>
        <label>
          Root SSH password
          <input
            type="password"
            autoComplete="current-password"
            maxLength={4096}
            required
            value={password}
            disabled={busy}
            onChange={(event) => {
              setPassword(event.target.value);
              setInspection(null);
              setConfirmation("");
              setError(null);
            }}
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !password}
          onClick={() => {
            void inspect();
          }}
        >
          {busy && !inspection && <LoaderCircle size={15} className="spin" />}
          Inspect Noted installation
        </Button>
        {inspection && (
          <>
            <dl className="cleanup-summary">
              <div>
                <dt>Installation</dt>
                <dd>
                  {inspection.present
                    ? inspection.serverName
                    : "Already absent"}
                </dd>
              </div>
              {inspection.domain && (
                <div>
                  <dt>Domain</dt>
                  <dd>{inspection.domain}</dd>
                </div>
              )}
              <div>
                <dt>Docker data</dt>
                <dd>
                  {inspection.containerCount} containers,{" "}
                  {inspection.volumeCount} volumes
                </dd>
              </div>
            </dl>
            <label className="check-label">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={busy}
                required
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I have saved any backup I need and understand that deletion is
              permanent.
            </label>
            <label>
              Type I LOVE VERITY exactly to confirm
              <input
                aria-label="Setup cleanup confirmation"
                value={confirmation}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="host-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={close}
          >
            Keep server
          </Button>
          <Button
            variant="danger"
            disabled={
              busy ||
              !inspection ||
              !acknowledged ||
              confirmation !== "I LOVE VERITY"
            }
          >
            {busy && inspection ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Trash2 size={15} />
            )}
            {busy && inspection
              ? "Removing Noted..."
              : "Permanently remove Noted"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
