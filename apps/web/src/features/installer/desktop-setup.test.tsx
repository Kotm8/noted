import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopSetup } from "./desktop-setup";
import type { InstallationJob, InstallationPlan } from "./desktop-types";

const plan: InstallationPlan = {
  host: { ip: "203.0.113.10", port: 22 }, hostKey: "ssh-ed25519 test-key",
  serverName: "My notes", domain: "notes.example.com", username: "owner",
  repository: "kotm8/noted", releaseCommit: "a".repeat(40), manifestSha256: "b".repeat(64),
};
const waiting: InstallationJob = { status: "waiting_dns", phase: "https", detail: "Point your domain to the VPS.", plan };

function respond(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status }));
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
}

async function enterServerAndAccount() {
  fill("Server name", "My notes"); fill("Server IP", "203.0.113.10");
  fill("SSH password", "ssh-test-password-only");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "A home for your notes" });
  fill("Domain", "notes.example.com");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Your Noted account" });
  fill("Username", "owner"); fill("Password", "owner-test-password-only");
  fill("Confirm password", "owner-test-password-only");
}

beforeEach(() => vi.spyOn(window, "scrollTo").mockImplementation(() => {}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("desktop server setup", () => {
  it("stops at an unavailable release without starting an installation or sending credentials", async () => {
    const fetcher = vi.fn((path: string) => path.endsWith("/host")
      ? respond({ hostKey: plan.hostKey, fingerprint: "SHA256:test-fingerprint" })
      : respond({ detail: "Publish the Noted release files first." }, 404));
    vi.stubGlobal("fetch", fetcher);
    render(<DesktopSetup initialJob={null} close={vi.fn()} connected={vi.fn()} />);
    await enterServerAndAccount();
    fireEvent.click(screen.getByRole("button", { name: "Review setup" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("Publish the Noted release");
    expect(fetcher.mock.calls.every(([path]) => path !== "/desktop/setup")).toBe(true);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("ssh-test-password-only");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("owner-test-password-only");
  });

  it("requires host-key confirmation and keeps a DNS failure recoverable", async () => {
    const connected = vi.fn().mockResolvedValue(undefined);
    let verified = false;
    const fetcher = vi.fn((path: string, options?: RequestInit) => {
      if (path.endsWith("/host")) return respond({ hostKey: plan.hostKey, fingerprint: "SHA256:test-fingerprint" });
      if (path.endsWith("/release")) return respond({ version: "0.1.0", commit: plan.releaseCommit, manifestSha256: plan.manifestSha256 });
      if (path.endsWith("/verify")) return verified ? respond({ ...waiting, status: "complete" }) : respond({ detail: "HTTPS is not ready yet." }, 502);
      return respond(options?.method === "POST" ? { ...waiting, status: "running", phase: "images" } : waiting);
    });
    vi.stubGlobal("fetch", fetcher);
    render(<DesktopSetup initialJob={null} close={vi.fn()} connected={connected} />);
    await enterServerAndAccount();
    fireEvent.click(screen.getByRole("button", { name: "Review setup" }));
    await screen.findByRole("heading", { name: "Review your setup" });
    expect(screen.getByRole("button", { name: "Install on server" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I verified this SSH fingerprint with my VPS." }));
    fireEvent.click(screen.getByRole("button", { name: "Install on server" }));
    await screen.findByRole("heading", { name: "Your server is installed." }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Check connection and open Noted" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("HTTPS is not ready yet");
    expect(connected).not.toHaveBeenCalled();
    verified = true;
    fireEvent.click(screen.getByRole("button", { name: "Check connection and open Noted" }));
    await waitFor(() => expect(connected).toHaveBeenCalledOnce());
    const submitted = fetcher.mock.calls.find(([path, options]) => path === "/desktop/setup" && options?.method === "POST");
    expect(JSON.parse(String(submitted?.[1]?.body)).plan.hostKey).toBe(plan.hostKey);
  });

  it("reopens the DNS step without asking for SSH credentials again", () => {
    render(<DesktopSetup initialJob={waiting} close={vi.fn()} connected={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your server is installed." })).toBeVisible();
    expect(screen.queryByLabelText("SSH password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check connection and open Noted" })).toBeEnabled();
  });
});
