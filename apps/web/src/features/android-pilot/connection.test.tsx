import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { androidPilot } from "../../lib/android-pilot";
import { AndroidPilotConnection } from "./connection";

vi.mock("../../lib/android-pilot", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../lib/android-pilot")>();
  return {
    ...original,
    androidPilot: {
      profile: vi.fn().mockResolvedValue({ server: null }),
      connect: vi
        .fn()
        .mockResolvedValue({ server: "https://notes.example.com" }),
    },
  };
});

test("submits a bare hostname to the Android connection bridge", async () => {
  const user = userEvent.setup();
  render(
    <AndroidPilotConnection>
      <p>Connected</p>
    </AndroidPilotConnection>,
  );

  const address = await screen.findByRole("textbox", {
    name: "Server address",
  });
  await user.type(address, "notes.example.com");
  expect(address).toBeValid();
  await user.click(screen.getByRole("button", { name: "Connect" }));

  expect(androidPilot.connect).toHaveBeenCalledWith({
    server: "notes.example.com",
  });
  expect(await screen.findByText("Connected")).toBeVisible();
});
