import { ExternalLink, Smartphone } from "lucide-react";
import type { SetupStepProps } from "../types";
import { androidPackageName } from "../firebase";
import { FirebaseJsonField } from "./firebase-json-field";

export function AndroidNotificationsStep({
  draft,
  update,
  optional = true,
}: SetupStepProps & { optional?: boolean }) {
  return (
    <section className="installation-step android-notifications-step">
      {optional ? <h1>Android notifications</h1> : <h4>Set up Firebase</h4>}
      <p>
        Use your own Firebase project for native phone notifications. This is
        optional; browser notifications work without it.
      </p>
      {optional && (
        <label className="setup-checkbox">
          <input
            type="checkbox"
            checked={draft.androidNotifications}
            onChange={(event) => {
              update("androidNotifications", event.target.checked);
              if (!event.target.checked) {
                update("googleServicesJson", "");
                update("serviceAccountJson", "");
              }
            }}
          />
          Configure Firebase for this server
        </label>
      )}
      {draft.androidNotifications ? (
        <>
          <ol className="firebase-setup-guide">
            <li>
              <strong>Create a project.</strong> Open the{" "}
              <a
                href="https://console.firebase.google.com/"
                target="_blank"
                rel="noreferrer"
              >
                Firebase console <ExternalLink size={12} />
              </a>{" "}
              and create a project for this server. Google Analytics is
              optional. FCM does not require Cloud Functions or a paid Firebase
              plan.
            </li>
            <li>
              <strong>Register the Android app.</strong> In{" "}
              <strong>Project settings &gt; General &gt; Your apps</strong>,
              choose Android and use this exact package name:{" "}
              <code>{androidPackageName}</code>. Download{" "}
              <code>google-services.json</code> and import or paste it below.
              You do not need to edit or build the APK yourself.
            </li>
            <li>
              <strong>Enable sending.</strong> In{" "}
              <strong>Project settings &gt; Cloud Messaging</strong>, check that{" "}
              <strong>Firebase Cloud Messaging API (V1)</strong> is enabled.
              Follow the console's API link if it needs enabling.
            </li>
            <li>
              <strong>Create the server key.</strong> In{" "}
              <strong>
                Project settings &gt; Service accounts &gt; Firebase Admin SDK
              </strong>
              , choose <strong>Generate new private key</strong>. Import or
              paste that downloaded JSON in the second field.
            </li>
          </ol>
          <FirebaseJsonField
            label="Android app JSON"
            filename="google-services.json"
            value={draft.googleServicesJson}
            change={(value) => update("googleServicesJson", value)}
          />
          <FirebaseJsonField
            label="Service-account JSON"
            filename="service-account JSON"
            value={draft.serviceAccountJson}
            change={(value) => update("serviceAccountJson", value)}
            privateKey
          />
          <p className="setup-help">
            The private key is sent {optional ? "over SSH" : "over HTTPS"} to
            your VPS and stored with restricted permissions. It is excluded from
            content backups and installation history. Keep your original key
            file somewhere private.
          </p>
          <p className="setup-help">
            After setup, install the latest APK, sign in, and enable
            notifications to pair your phone. Servers without Firebase keep
            using browser notifications.
          </p>
          <div className="setup-reference-links">
            <a
              href="https://firebase.google.com/docs/android/setup"
              target="_blank"
              rel="noreferrer"
            >
              Android setup guide <ExternalLink size={12} />
            </a>
            <a
              href="https://firebase.google.com/docs/cloud-messaging/auth-server"
              target="_blank"
              rel="noreferrer"
            >
              Server credentials guide <ExternalLink size={12} />
            </a>
          </div>
        </>
      ) : (
        <p className="setup-help">
          <Smartphone size={15} /> Continue to skip Firebase setup. Your
          existing notification options stay available.
        </p>
      )}
    </section>
  );
}
