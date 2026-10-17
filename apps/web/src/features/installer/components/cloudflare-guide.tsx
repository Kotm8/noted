import { ExternalLink } from "lucide-react";

export function CloudflareGuide({ address }: { address: string }) {
  const ipv6 = address.includes(":");
  return (
    <details className="cloudflare-guide" open>
      <summary>Use a Cloudflare subdomain</summary>
      <p>
        For <strong>notes.example.com</strong>, select <strong>example.com</strong> in Cloudflare,
        then open <strong>DNS → Records → Add record</strong>.
      </p>
      <dl className="dns-example">
        <div>
          <dt>Type</dt>
          <dd>{ipv6 ? "AAAA" : "A"}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>notes</dd>
        </div>
        <div>
          <dt>{ipv6 ? "IPv6 address" : "IPv4 address"}</dt>
          <dd>{address || "Your VPS IP"}</dd>
        </div>
        <div>
          <dt>Proxy status</dt>
          <dd>DNS only</dd>
        </div>
        <div>
          <dt>TTL</dt>
          <dd>Auto</dd>
        </div>
      </dl>
      <ol>
        <li>
          Replace <strong>notes</strong> with your chosen subdomain. An existing main website stays
          on its current record. Use <strong>@</strong> if you want to use the main domain itself.
        </li>
        <li>
          Allow inbound TCP ports <strong>80</strong> and <strong>443</strong> on the VPS and its
          provider firewall. Keep your SSH port reachable.
        </li>
        <li>Wait for DNS to point to the VPS. Caddy can then obtain the HTTPS certificate.</li>
        <li>
          Keep DNS only for 250 MB attachments and large backup imports. Cloudflare's Free/Pro proxy
          limits uploads to 100 MB per request. If you enable proxying for smaller uploads, use{" "}
          <strong>SSL/TLS → Full (strict)</strong>. Check existing sites' origin certificates before
          changing the whole zone's SSL mode.
        </li>
      </ol>
      <p>
        Only add an AAAA record if the VPS serves this app over IPv6. Leave Cloudflare's login
        credentials in Cloudflare.
      </p>
      <div className="setup-reference-links">
        <a
          href="https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/"
          target="_blank"
          rel="noreferrer"
        >
          Subdomain guide <ExternalLink size={12} />
        </a>
        <a
          href="https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/"
          target="_blank"
          rel="noreferrer"
        >
          Full (strict) <ExternalLink size={12} />
        </a>
      </div>
    </details>
  );
}
