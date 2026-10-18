import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CleanupDialog } from "./cleanup-dialog";
import type { InstallationPlan } from "../desktop-types";

const plan: InstallationPlan = {
  host: { ip: "203.0.113.10", port: 22 },
  hostKey: "ssh-ed25519 test",
  serverName: "Notes",
  domain: "notes.example.com",
  username: "owner",
  repository: "owner/noted",
  releaseCommit: "a".repeat(40),
  manifestSha256: "b".repeat(64),
};

afterEach(() => vi.unstubAllGlobals());

it("requires inspection, backup acknowledgement, and the exact phrase before removal", async () => {
  const cleaned = vi.fn();
  const fetcher = vi.fn((path: string) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          path.endsWith("inspect")
            ? {
                present: true,
                serverName: "Original notes",
                domain: plan.domain,
                snapshot: "c".repeat(64),
                containerCount: 3,
                volumeCount: 4,
              }
            : { status: "running", phase: "cleanup", plan },
        ),
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<CleanupDialog plan={plan} close={vi.fn()} started={cleaned} />);
  const remove = screen.getByRole("button", {
    name: "Permanently remove Noted",
  });
  expect(remove).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Root SSH password"), {
    target: { value: "test-root-password" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Noted installation" }),
  );
  await screen.findByText("Original notes");
  fireEvent.change(screen.getByLabelText("Setup cleanup confirmation"), {
    target: { value: "I LOVE VERITY" },
  });
  expect(remove).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  expect(remove).toBeEnabled();
  fireEvent.click(remove);
  await waitFor(() => expect(cleaned).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
    "/desktop/setup/cleanup/inspect",
    "/desktop/setup/cleanup",
  ]);
});

it("does not enable removal after a failed inspection", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Another application uses a Noted volume." }),
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<CleanupDialog plan={plan} close={vi.fn()} started={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Root SSH password"), {
    target: { value: "test-root-password" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Noted installation" }),
  );
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Permanently remove Noted" }),
  ).toBeDisabled();
  expect(fetcher).toHaveBeenCalledOnce();
});
