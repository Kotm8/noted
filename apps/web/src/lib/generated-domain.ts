/**
 * An address that sslip.io resolves to the IP written inside it, so a server
 * without a domain still gets a real HTTPS certificate. IPv6 colons become dashes.
 */
export function generatedDomain(ip: string): string {
  return `${ip.trim().toLowerCase().replaceAll(/[.:]/g, "-")}.sslip.io`;
}

export function isGeneratedDomain(address: string): boolean {
  return /\.sslip\.io\/?$/.test(address.trim().toLowerCase());
}
