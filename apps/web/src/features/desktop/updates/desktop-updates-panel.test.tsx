import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { DesktopUpdatesPanel } from "./desktop-updates-panel";
import { desktopRequest } from "../desktop-request";
import type { DesktopUpdateStatus } from "./use-desktop-updates";

vi.mock("../connection-context", () => ({ isDesktop: true }));
vi.mock("../desktop-request", () => ({ desktopRequest: vi.fn() }));

let status: DesktopUpdateStatus;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  status = {
    supported: true,
    current_version: "0.2.1",
    latest_version: null,
    notes: null,
    checked_at: null,
    phase: "idle",
    downloaded_bytes: 0,
    total_bytes: null,
    error: null,
  };
  vi.mocked(desktopRequest).mockReset();
  vi.mocked(desktopRequest).mockImplementation(async (_path, method, body) => {
    if (method === "POST") {
      const action = (body as { action: string }).action;
      calls.push(action);
      if (action === "check")
        status = {
          ...status,
          phase: "available",
          latest_version: "0.2.2",
          checked_at: 1700000000,
          notes: "- A newer desktop client.",
        };
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
      <DesktopUpdatesPanel />
    </QueryClientProvider>,
  );
}

it("checks and downloads without installing until restart is explicitly confirmed", async () => {
  show();
  fireEvent.click(
    await screen.findByRole("button", { name: "Check for updates" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Download update" }),
  );
  await screen.findByText("Noted 0.2.2 is downloaded and verified.");
  expect(calls).toEqual(["check", "download"]);
  fireEvent.click(screen.getByRole("button", { name: "Restart and install" }));
  let dialog = screen.getByRole("dialog", { name: "Install desktop update?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Keep working" }));
  expect(calls).toEqual(["check", "download"]);
  fireEvent.click(screen.getByRole("button", { name: "Restart and install" }));
  dialog = screen.getByRole("dialog", { name: "Install desktop update?" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Restart and install" }),
  );
  await waitFor(() => expect(calls).toEqual(["check", "download", "install"]));
});

it("does not offer installation when signature verification fails", async () => {
  status = {
    ...status,
    latest_version: "0.2.2",
    phase: "error",
    error: "The update signature did not verify. Nothing was installed.",
  };
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "signature did not verify",
  );
  expect(
    screen.queryByRole("button", { name: "Restart and install" }),
  ).toBeNull();
  expect(calls).toEqual([]);
});
