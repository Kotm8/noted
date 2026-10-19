import type { InstallationDraft } from "./types";
import { firebaseError } from "./firebase";

function isIpAddress(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }
  if (!value.includes(":")) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.startsWith("[");
  } catch {
    return false;
  }
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, "")
    .replace(/\/$/, "");
}

export function validateStep(
  step: number,
  draft: InstallationDraft,
): string | null {
  if (step === 0) {
    if (!draft.serverName.trim()) return "Give this server a name.";
    if (!isIpAddress(draft.host.trim()))
      return "Enter the VPS IPv4 or IPv6 address.";
    if (
      !/^\d+$/.test(draft.port) ||
      Number(draft.port) < 1 ||
      Number(draft.port) > 65535
    )
      return "Use an SSH port between 1 and 65535.";
    if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(draft.sshUser))
      return "Enter a valid SSH username.";
    if (!draft.sshPassword) return "Enter the SSH password for this server.";
  }
  if (step === 1) {
    const domain = normalizeDomain(draft.domain);
    if (
      domain.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        domain,
      ) ||
      isIpAddress(domain)
    )
      return "Enter a domain such as notes.example.com, without a path or port.";
  }
  if (step === 2) {
    if (!/^[\p{L}\p{N}_. -]{1,64}$/u.test(draft.username.trim()))
      return "Choose a username using letters, numbers, spaces, dots, underscores, or hyphens.";
    if (draft.password.length < 12 || draft.password.length > 256)
      return "Use an owner password of 12 to 256 characters.";
    if (draft.password !== draft.confirmation)
      return "The owner passwords do not match.";
  }
  if (step === 3 && draft.androidNotifications) return firebaseError(draft);
  return null;
}
