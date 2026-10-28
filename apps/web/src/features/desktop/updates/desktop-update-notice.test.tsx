import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdateNotice } from "./desktop-update-notice";
import { desktopRequest } from "../desktop-request";
import type { DesktopUpdateStatus } from "./use-desktop-updates";

vi.mock("../connection-context", () => ({ isDesktop: true }));
vi.mock("../desktop-request", () => ({ desktopRequest: vi.fn() }));

let status: DesktopUpdateStatus;
const calls: string[] = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  status = {
    supported: true,
    current_version: "0.2.6",
    latest_version: "0.3.0",
    notes: "- Formatting toolbar",
    checked_at: 1700000000,
    phase: "available",
    downloaded_bytes: 0,
    total_bytes: null,
    error: null,
  };
  vi.mocked(desktopRequest).mockReset();
  vi.mocked(desktopRequest).mockImplementation(async (_path, method, body) => {
    if (method === "POST") {
      const action = (body as { action: string }).action;
      calls.push(action);
      if (action === "download") status = { ...status, phase: "ready" };
      if (action === "install") status = { ...status, phase: "installing" };
    }
    return { ...status };
  });
});

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DesktopUpdateNotice />
    </QueryClientProvider>,
  );
}

it("updates in two clicks: download, then restart", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Update" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Restart to update" }),
  );
  await waitFor(() => expect(calls).toEqual(["download", "install"]));
});

it("remembers a skipped version", async () => {
  const { unmount } = show();
  fireEvent.click(await screen.findByRole("button", { name: "What's new" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip this version" }));
  await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  unmount();
  show();
  await waitFor(() => expect(desktopRequest).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
});

it("offers a retry when the update fails", async () => {
  status = {
    ...status,
    phase: "error",
    error: "The signature did not verify.",
  };
  show();
  expect(
    await screen.findByText("The signature did not verify."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(calls).toEqual(["download"]));
});
