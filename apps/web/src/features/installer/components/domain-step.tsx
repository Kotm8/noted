import type { SetupStepProps } from "../types";
import { normalizeDomain } from "../validation";
import { CloudflareGuide } from "./cloudflare-guide";

export function DomainStep({ draft, update }: SetupStepProps) {
  return (
    <section className="installation-step">
      <h1>A home for your notes</h1>
      <p>Use your domain or a subdomain. This is where you'll open Noted in a browser.</p>
      <label>
        Domain
        <input
          autoFocus
          aria-label="Domain"
          aria-describedby="domain-help"
          value={draft.domain}
          required
          maxLength={261}
          placeholder="notes.example.com"
          autoComplete="off"
          onChange={(event) => update("domain", event.target.value)}
        />
        <small id="domain-help">
          {draft.domain
            ? `Your app address: https://${normalizeDomain(draft.domain)}`
            : "For example, notes.example.com. Your main website can stay where it is."}
        </small>
      </label>
      <label className="setup-checkbox">
        <input
          type="checkbox"
          checked={draft.cloudflare}
          onChange={(event) => update("cloudflare", event.target.checked)}
        />
        My domain uses Cloudflare
      </label>
      {draft.cloudflare ? (
        <CloudflareGuide address={draft.host.trim()} />
      ) : (
        <p className="setup-help">
          At your DNS provider, point this hostname to the VPS IP. Allow inbound TCP 80 and 443 so
          Caddy can set up HTTPS.
        </p>
      )}
    </section>
  );
}
