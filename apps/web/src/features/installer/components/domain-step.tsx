import { useEffect } from "react";
import { CopyBox } from "../../../components/ui/copy-box";
import { generatedDomain } from "../../../lib/generated-domain";
import type { SetupStepProps } from "../types";
import { normalizeDomain } from "../validation";
import { CloudflareGuide } from "./cloudflare-guide";

function GeneratedAddress({ domain }: { domain: string }) {
  return (
    <div className="setup-generated">
      <p>
        No domain needed. Noted gives your server a free address made from its
        IP, through <strong>sslip.io</strong>: a free public service that points
        names like this one to the IP written inside them. Caddy still gets a
        real HTTPS certificate, so signing in, notifications, and the Android
        app all work.
      </p>
      <span className="setup-copy-label">Your app address</span>
      <CopyBox value={`https://${domain}`} />
      <ul>
        <li>
          Nothing to set up at a DNS provider. Allow inbound TCP 80 and 443 on
          the VPS so the certificate can be issued.
        </li>
        <li>
          The address contains your server's IP, so it changes if the IP ever
          changes.
        </li>
        <li>
          It relies on sslip.io being up to find your server. Get a domain any
          time and switch to it in <strong>Settings › Server</strong>.
        </li>
      </ul>
    </div>
  );
}

export function DomainStep({ draft, update }: SetupStepProps) {
  const generated = generatedDomain(draft.host);
  useEffect(() => {
    if (!draft.ownDomain && draft.domain !== generated)
      update("domain", generated);
  }, [draft.ownDomain, draft.domain, generated, update]);

  return (
    <section className="installation-step">
      <h1>A home for your notes</h1>
      <p>This is the address where you'll open Noted in a browser.</p>
      <div className="setup-choices" role="radiogroup" aria-label="Address">
        <label className="setup-choice">
          <input
            type="radio"
            name="domain-kind"
            checked={draft.ownDomain}
            onChange={() => {
              update("ownDomain", true);
              update("domain", "");
              update("cloudflare", true);
            }}
          />
          <span>
            <strong>I have a domain</strong>
            <small>
              Use your domain or a subdomain, like notes.example.com.
            </small>
          </span>
        </label>
        <label className="setup-choice">
          <input
            type="radio"
            name="domain-kind"
            checked={!draft.ownDomain}
            onChange={() => {
              update("ownDomain", false);
              update("domain", generated);
              update("cloudflare", false);
            }}
          />
          <span>
            <strong>I don't have a domain</strong>
            <small>Use a free address made from your server's IP.</small>
          </span>
        </label>
      </div>
      {draft.ownDomain ? (
        <>
          <label className="setup-domain-field">
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
              At your DNS provider, point this hostname to the VPS IP. Allow
              inbound TCP 80 and 443 so Caddy can set up HTTPS.
            </p>
          )}
        </>
      ) : (
        <GeneratedAddress domain={generated} />
      )}
    </section>
  );
}
