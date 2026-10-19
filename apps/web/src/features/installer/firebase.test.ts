import { describe, expect, it } from "vitest";
import { firebaseError, firebaseProject } from "./firebase";

export function firebaseFixture() {
  return {
    googleServicesJson: JSON.stringify({
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
    }),
    serviceAccountJson: JSON.stringify({
      type: "service_account",
      project_id: "noted-fixture",
      client_email:
        "firebase-adminsdk-test@noted-fixture.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  };
}

describe("Firebase installer configuration", () => {
  it("finds the Noted Android app and verifies both projects", () => {
    expect(firebaseProject(firebaseFixture())).toBe("noted-fixture");
    const setup = firebaseFixture();
    setup.serviceAccountJson = setup.serviceAccountJson.replace(
      "noted-fixture",
      "other-project",
    );
    expect(firebaseError(setup)).toMatch(/same Firebase project/);
  });

  it("rejects a different package, sender ID, and credential endpoint", () => {
    const setup = firebaseFixture();
    expect(
      firebaseError({
        ...setup,
        googleServicesJson: setup.googleServicesJson.replace(
          "com.noted.android",
          "another.app",
        ),
      }),
    ).toMatch(/com.noted.android/);
    expect(
      firebaseError({
        ...setup,
        googleServicesJson: setup.googleServicesJson.replace(
          "1:1234567890:",
          "1:999:",
        ),
      }),
    ).toMatch(/fresh google-services/);
    expect(
      firebaseError({
        ...setup,
        serviceAccountJson: setup.serviceAccountJson.replace(
          "https://oauth2.googleapis.com/token",
          "https://example.com/token",
        ),
      }),
    ).toMatch(/incomplete/);
  });

  it("keeps secrets out of errors and bounds file sizes", () => {
    const setup = firebaseFixture();
    const invalid = { ...setup, serviceAccountJson: 'secret-private-key{"' };
    const error = firebaseError(invalid);
    expect(error).toContain("valid JSON");
    expect(error).not.toContain("secret-private-key");
    expect(
      firebaseError({ ...setup, googleServicesJson: "x".repeat(32769) }),
    ).toContain("32 KB");
  });
});
