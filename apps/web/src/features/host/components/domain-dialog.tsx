import { Notice } from "../../../components/ui/notice";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { hostApi } from "../api";
import type { HostJob } from "../types";

export function DomainDialog({
  onClose,
  onQueued,
}: {
  onClose: () => void;
  onQueued: (job: HostJob) => void;
}) {
  const [domain, setDomain] = useState("");
  const [password, setPassword] = useState("");
  const [dns, setDns] = useState(false);
  const change = useMutation({
    mutationFn: hostApi.domain,
    onSuccess: (job) => {
      setPassword("");
      onQueued({
        ...job,
        destination: `https://${domain.trim().toLowerCase()}`,
      });
      onClose();
    },
  });
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
      title="Switch domain"
      description="Keep this VPS and your content. Change the address you use to open Noted."
      className="host-dialog"
    >
      <form
        className="host-form"
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate({
            domain,
            current_password: password,
            dns_confirmed: true,
          });
        }}
      >
        <label>
          New domain
          <input
            aria-label="New domain"
            placeholder="notes.example.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
            maxLength={253}
            autoCapitalize="none"
          />
        </label>
        <ol className="host-instructions">
          <li>
            In Cloudflare DNS, add an A record for the new hostname pointing to
            this VPS. Add AAAA only if the VPS serves IPv6.
          </li>
          <li>
            Start with DNS only. Keep the old DNS record during verification.
          </li>
          <li>Wait for DNS to resolve. Leave ports 80 and 443 reachable.</li>
          <li>
            After switching, sign in at the new address. Keep DNS only for 250
            MB attachments and large backup imports. Cloudflare's Free/Pro proxy
            limits uploads to 100 MB per request.
          </li>
        </ol>
        <label className="check-label">
          <input
            type="checkbox"
            checked={dns}
            onChange={(event) => setDns(event.target.checked)}
            required
          />
          The new DNS record points to this VPS.
        </label>
        <label>
          Current owner password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <p className="settings-hint">
          Noted verifies the new HTTPS address and restores the previous domain
          if verification fails. Your account and content remain unchanged.
        </p>
        {change.error && <Notice tone="error">{change.error.message}</Notice>}
        <div className="host-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={change.isPending}
          >
            Cancel
          </Button>
          <Button disabled={!dns || !password || !domain || change.isPending}>
            {change.isPending ? "Queuing domain change..." : "Switch domain"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
