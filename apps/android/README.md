# Noted for Android

Android clients for a self-hosted Noted server. In 0.5.0 the phone app packages Noted's shared React interface locally through Capacitor under `com.noted.android`. Android 8.0 or newer is required.

The phone interface follows Noted's shared design language. Account appearance settings synchronize colors, text size, interface zoom, and message presentation across clients. Cached responses and images let previously opened content remain available without waiting for the server. Drafts and a persistent text-message outbox are stored locally; the server remains authoritative.

## Modules

- `app`: phone screens, local storage, authenticated networking, native notifications, and watch pairing.
- `wear`: the Wear OS companion for tracking activities, plans, and reminders.
- `watchface`: the resource-only Watch Face Format package bundled with the watch APK.

Phone screens live in `apps/web`. The Android module contains the scoped bridge, secure storage, Firebase, the tracker tile and notification, photo capture, Android intents, and watch pairing.

Credentials use Android Keystore-backed encryption. Cached content is separated by server origin and owner, and sign-out clears that account's local data. Release connections require HTTPS. Notification and watch credentials are scoped to the selected server and cannot silently switch it.

Native phone notifications use the selected server owner's Firebase project. The same APK loads public client configuration during authenticated pairing; the private service-account key remains on the VPS. Firebase configuration is optional, but background push delivery requires it. Browser push notifications are not supported. Phone and watch push delivery use Firebase only.

## Development

Requires Python, Node.js 24, JDK 21, Android SDK Platform 36, and Build Tools 36.0.0.

Run `python scripts/android.py check` from the repository root to build the phone's React bundle, assemble debug APKs, run unit tests and lint, and compile the phone and watch instrumentation APKs. Instrumentation execution requires an emulator or device. `scripts/native_android_test.py` starts a disposable backend for phone testing.

Run `python scripts/android.py build` to build signed release APKs using the existing signing configuration. Retain the same signing key for compatible updates. The helper also exports the public app association for compatibility with older clients; the native phone runtime does not depend on browser association.

## Connection and upgrade

Enter your server as `notes.example.com` or `https://notes.example.com`. The app adds HTTPS to a bare hostname.

The bottom bar includes Home, Food, Calendar and Finance. Habits takes the Food slot when Nutrition is disabled. Open the drawer to find Notes channels. Home shows the tracker, habit progress, Nutrition, tracked time, upcoming plans and reminders. Finance supports account balances and receipt photos.

To test native alerts, configure `com.noted.android` in the server's Firebase project. Open Settings > Notifications, enable alerts on this phone, and send a test alert. Firebase acceptance appears in Settings, and actual arrival appears in Android's notification tray.

For emulator UI testing, forward port 8123 with ADB reverse and enter `http://localhost:8123` while the disposable native test fixture is running. This fixture supports the UI and API checks. Native push enrollment requires HTTPS.

The 0.5.0 APK uses version code 18 and upgrades the existing installation when signed with the same certificate. It keeps the existing server and asks the owner to sign in. In **Settings > Server > Recover unsent work**, the owner can export drafts and queued messages and copy them into Noted. The export preserves the original queued IDs. Export before uninstalling or clearing app storage, since either operation removes the original database.

Implementation details, verification results, upgrade behavior, and remaining device checks are in [the native Android handoff](../../docs/clients/android.md).
