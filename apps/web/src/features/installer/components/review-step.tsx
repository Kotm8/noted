import { Notice } from "../../../components/ui/notice";
import type { ReactNode } from "react";
import type { InstallationDraft } from "../types";
import { normalizeDomain } from "../validation";

export function ReviewStep({
  draft,
  preview = true,
  details = [],
  children,
}: {
  draft: InstallationDraft;
  preview?: boolean;
  details?: string[][];
  children?: ReactNode;
}) {
  const rows = [
    ["Server name", draft.serverName.trim()],
    ["SSH connection", `${draft.sshUser}@${draft.host}:${draft.port}`],
    ["App address", `https://${normalizeDomain(draft.domain)}`],
    ["Owner", draft.username.trim()],
    ["Access", "Private, owner only"],
    ...details,
  ];
  return (
    <section className="installation-step">
      <h1>Review your setup</h1>
      <p>Check the destination and account before installing on your VPS.</p>
      <dl className="installation-review">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {label === "SSH fingerprint" ? <code>{value}</code> : value}
            </dd>
          </div>
        ))}
      </dl>
      {children}
      <p className="setup-help">
        Passwords are hidden and kept only in memory during setup.
      </p>
      <Notice>
        <strong>{preview ? "Preview ends here" : "Ready to install"}</strong>
        <p>
          {preview
            ? "This browser preview has not contacted your VPS, changed DNS, or created an account. Install the desktop app to set up a server."
            : "Setup installs Docker if needed, downloads Noted, and creates your owner account. DNS stays under your control. Existing services are kept; occupied web ports stop installation."}
        </p>
      </Notice>
    </section>
  );
}
