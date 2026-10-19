import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../lib/http";
import { androidPushStatus } from "./android";
import { AndroidNotificationsPanel } from "./android-notifications-panel";

vi.mock("../../lib/http", () => ({ request: vi.fn() }));
vi.mock("./android", () => ({
  androidPushStatus: vi.fn(),
  isAndroidApp: () => false,
}));

const preferences = {
  enabled: true,
  android_enabled: true,
  snooze_minutes: 10,
};
const disconnected = { configured: false, subscribed: false, project_id: null };
const connected = {
  configured: true,
  subscribed: false,
  project_id: "noted-fixture",
};

function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AndroidNotificationsPanel
        preferences={preferences}
        saving={false}
        onChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(androidPushStatus).mockResolvedValue(disconnected);
});

describe("Android notifications after skipped installer setup", () => {
  it("shows the guide, locks Android controls, then hides the guide and clears secrets after saving", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { name: "Set up Firebase" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Send notifications to Android" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /Firebase console/ }),
    ).toHaveAttribute("href", "https://console.firebase.google.com/");
    const services = JSON.stringify({
      project_info: {
        project_id: "noted-fixture",
        project_number: "1234567890",
      },
      client: [
        {
          client_info: {
            mobilesdk_app_id: "1:1234567890:android:abcdef",
            android_client_info: { package_name: "com.noted.android" },
          },
          api_key: [{ current_key: `AIza${"a".repeat(35)}` }],
        },
      ],
    });
    const account = JSON.stringify({
      type: "service_account",
      project_id: "noted-fixture",
      client_email: "test@noted-fixture.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    fireEvent.change(
      screen.getByLabelText("Android app JSON", { exact: true }),
      { target: { value: services } },
    );
    fireEvent.change(
      screen.getByLabelText("Service-account JSON", { exact: true }),
      { target: { value: account } },
    );
    vi.mocked(request).mockResolvedValue(connected);
    fireEvent.click(
      screen.getByRole("button", { name: "Save Firebase configuration" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Set up Firebase" }),
      ).not.toBeInTheDocument(),
    );
    expect(request).toHaveBeenCalledWith(
      "/notifications/android/config",
      "PUT",
      { googleServicesJson: services, serviceAccountJson: account },
    );
    expect(
      screen.getByRole("checkbox", { name: "Send notifications to Android" }),
    ).toBeEnabled();
    expect(screen.getByText("Firebase connected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change project" }));
    expect(
      screen.getByLabelText("Service-account JSON", { exact: true }),
    ).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(
      screen.queryByRole("heading", { name: "Set up Firebase" }),
    ).not.toBeInTheDocument();
  });

  it("opens configured servers without showing the setup guide", async () => {
    vi.mocked(androidPushStatus).mockResolvedValue(connected);
    mount();
    expect(await screen.findByText("Firebase connected")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Set up Firebase" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Send notifications to Android" }),
    ).toBeEnabled();
  });
});
