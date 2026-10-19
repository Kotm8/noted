import { Check, Circle, LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";
import type { InstallationJob } from "../desktop-types";
import { CloudflareGuide } from "./cloudflare-guide";

const phases = [
  ["release", "Verify release"],
  ["ssh", "Connect over SSH"],
  ["preflight", "Check the VPS"],
  ["docker", "Prepare Docker"],
  ["upload", "Upload installation files"],
  ["images", "Download server images"],
  ["starting", "Start server and migrate data"],
  ["owner", "Create owner account"],
  ["android_notifications", "Save Android configuration, if supplied"],
  ["updater", "Enable server updates"],
  ["https", "Connect through HTTPS"],
];

interface Props {
  job: InstallationJob;
  busy: boolean;
  error: string | null;
  verify: () => void;
  retry: () => void;
}

export function InstallationProgress({
  job,
  busy,
  error,
  verify,
  retry,
}: Props) {
  if (job.phase === "cleanup" && job.status === "running")
    return (
      <section className="installation-step">
        <h1>Removing Noted from the VPS.</h1>
        <p role="status">{job.detail}</p>
        <p className="setup-help">
          <LoaderCircle size={16} className="animate-spin" /> Keep Noted open
          until cleanup finishes.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
      </section>
    );
  const current = phases.findIndex(([phase]) => phase === job.phase);
  return (
    <section className="installation-step">
      <h1>
        {job.status === "waiting_dns"
          ? "Your server is installed."
          : job.status === "failed"
            ? "Setup needs attention."
            : "Setting up your server."}
      </h1>
      <p role="status">{job.detail}</p>
      <ol
        className="installation-progress"
        aria-label="Server installation progress"
      >
        {phases.map(([phase, label], index) => (
          <li key={phase} aria-current={current === index ? "step" : undefined}>
            {index < current ? (
              <Check size={16} />
            ) : index === current && job.status === "running" ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <Circle size={14} />
            )}
            {label}
          </li>
        ))}
      </ol>
      {job.status === "waiting_dns" && (
        <>
          <p className="setup-help">
            Point <strong>{job.plan?.domain}</strong> to{" "}
            <strong>{job.plan?.host.ip}</strong>. Keep Cloudflare set to DNS
            only. DNS and certificate issuance can take a few minutes.
          </p>
          <CloudflareGuide address={job.plan?.host.ip ?? ""} />
          <Button
            type="button"
            className="installation-verify"
            onClick={verify}
            disabled={busy}
          >
            {busy && <LoaderCircle size={15} className="animate-spin" />}
            {busy ? "Checking HTTPS..." : "Check connection and open Noted"}
          </Button>
        </>
      )}
      {job.status === "running" && (
        <p className="setup-help">
          Keep Noted open while installation runs. Downloads happen directly on
          your VPS.
        </p>
      )}
      {job.status === "failed" && (
        <Button type="button" variant="secondary" onClick={retry}>
          Review details and retry
        </Button>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
