import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugTrigger } from "./debug-trigger";
import { testPhoneNotification } from "./diagnostics";

vi.mock("./diagnostics", () => ({
  collectDiagnostics: vi.fn(async () => ({
    capturedAt: "2026-10-17T12:00:00Z", client: "Web", checks: [
      { label: "Server connection", value: "ok (12 ms)", state: "ok" },
    ],
  })),
  testDeviceNotification: vi.fn(),
  testPhoneNotification: vi.fn(async () => "Push service accepted the test for 1 phone. Check your phone."),
}));

beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(100));
afterEach(() => vi.restoreAllMocks());

function mount() {
  render(<QueryClientProvider client={new QueryClient()}><DebugTrigger /></QueryClientProvider>);
  return screen.getByRole("button", { name: "Noted" });
}

describe("hidden diagnostics", () => {
  it("sends a phone test from the menu and reports provider failures", async () => {
    const logo = mount();
    for (let index = 0; index < 7; index++) fireEvent.click(logo);
    fireEvent.click(await screen.findByRole("button", { name: "Send test to phone" }, { timeout: 3000 }));
    expect(await screen.findByText("Push service accepted the test for 1 phone. Check your phone.")).toBeInTheDocument();
    vi.mocked(testPhoneNotification).mockRejectedValueOnce(new Error("No phone is subscribed."));
    fireEvent.click(screen.getByRole("button", { name: "Send test to phone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No phone is subscribed.");
  });

  it("opens after seven clicks, closes with Escape, and can be reopened", async () => {
    const logo = mount();
    for (let index = 0; index < 6; index++) fireEvent.click(logo);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(logo);
    expect(await screen.findByRole("dialog", { name: "Diagnostics" }, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText("ok (12 ms)")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    for (let index = 0; index < 7; index++) fireEvent.click(logo);
    expect(await screen.findByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
  });

  it("does not accumulate unrelated clicks across a pause", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const logo = mount();
    for (let index = 0; index < 6; index++) fireEvent.click(logo);
    clock.mockReturnValue(2000);
    fireEvent.click(logo);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    for (let index = 0; index < 6; index++) fireEvent.click(logo);
    expect(await screen.findByRole("dialog", { name: "Diagnostics" })).toBeInTheDocument();
  });
});
