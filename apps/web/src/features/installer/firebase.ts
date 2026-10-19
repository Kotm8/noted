export const androidPackageName = "com.noted.android";
export const firebaseFileLimit = 32768;

export interface FirebaseSetup {
  googleServicesJson: string;
  serviceAccountJson: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as JsonObject;
}

function read(value: string, name: string): JsonObject {
  if (!value.trim()) throw new Error(`Import or paste ${name}.`);
  if (new TextEncoder().encode(value).length > firebaseFileLimit)
    throw new Error(`${name} must be smaller than 32 KB.`);
  try {
    return object(JSON.parse(value));
  } catch {
    throw new Error(`${name} must contain the complete, valid JSON file.`);
  }
}

export function firebaseProject(setup: FirebaseSetup): string {
  const client = read(setup.googleServicesJson, "google-services.json");
  const project = object(client.project_info);
  if (
    typeof project.project_id !== "string" ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project.project_id)
  )
    throw new Error(
      "google-services.json is missing a valid Firebase project ID.",
    );
  const app = Array.isArray(client.client)
    ? client.client.find((value: unknown) => {
        const info = object(object(value).client_info);
        return (
          object(info.android_client_info).package_name === androidPackageName
        );
      })
    : undefined;
  if (!app)
    throw new Error(
      `Register the Android app as ${androidPackageName}, then download google-services.json again.`,
    );
  const info = object(object(app).client_info);
  const keys = object(app).api_key;
  if (
    typeof info.mobilesdk_app_id !== "string" ||
    !/^1:\d+:android:[a-f0-9]+$/.test(info.mobilesdk_app_id) ||
    !/^\d+$/.test(String(project.project_number ?? "")) ||
    info.mobilesdk_app_id.split(":")[1] !== String(project.project_number) ||
    !Array.isArray(keys) ||
    !keys.some(
      (key: unknown) =>
        typeof object(key).current_key === "string" &&
        /^AIza[\w-]{35}$/.test(String(object(key).current_key)),
    )
  )
    throw new Error(
      "Download a fresh google-services.json containing the Android app ID, sender ID, and API key.",
    );
  const account = read(setup.serviceAccountJson, "service-account JSON");
  if (account.type !== "service_account")
    throw new Error(
      "Use the private-key JSON from Project settings > Service accounts, not another google-services.json.",
    );
  if (account.project_id !== project.project_id)
    throw new Error(
      "Both JSON files must belong to the same Firebase project.",
    );
  if (
    typeof account.client_email !== "string" ||
    !account.client_email.endsWith(
      `@${project.project_id}.iam.gserviceaccount.com`,
    ) ||
    typeof account.private_key !== "string" ||
    !account.private_key.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
    !account.private_key.trimEnd().endsWith("-----END PRIVATE KEY-----") ||
    account.token_uri !== "https://oauth2.googleapis.com/token"
  )
    throw new Error(
      "The service-account JSON is incomplete. Download a new private key from Firebase.",
    );
  return project.project_id;
}

export function firebaseError(setup: FirebaseSetup): string | null {
  try {
    firebaseProject(setup);
    return null;
  } catch (failure) {
    return failure instanceof Error
      ? failure.message
      : "Check both Firebase JSON files.";
  }
}
