# Noted for Android

Native Android clients for a self-hosted Noted server. The phone app uses Kotlin and Jetpack Compose, connects directly to the existing HTTPS API, and renders its own interface. It does not embed Chrome, a Trusted Web Activity, or a WebView. Android 8.0 or newer is required.

The phone interface follows Noted's shared design language. Account appearance settings synchronize colors, text size, interface zoom, and message presentation across clients. Cached responses and images let previously opened content remain available without waiting for the server. Drafts and a persistent text-message outbox are stored locally; the server remains authoritative.

## Modules

- `app`: phone screens, local storage, authenticated networking, native notifications, and watch pairing.
- `wear`: the Wear OS companion for tracking activities, plans, and reminders.
- `watchface`: the resource-only Watch Face Format package bundled with the watch APK.

Within the phone module, `features/` contains screens grouped by feature, `ui/` contains Noted's reusable controls and theme, and `data/` contains sessions, API access, the response cache, and queued messages. `notifications/` and `watch/` contain device integrations.

Credentials use Android Keystore-backed encryption. Cached content is separated by server origin and owner, and sign-out clears that account's local data. Release connections require HTTPS. Notification and watch credentials are scoped to the selected server and cannot silently switch it.

Native phone notifications use the selected server owner's Firebase project. The same APK loads public client configuration during authenticated pairing; the private service-account key remains on the VPS. Firebase configuration is optional, but background push delivery requires it. Existing browser notifications remain a separate web-client capability.

## Development

Requires Python, JDK 17 or 21, Android SDK Platform 36, and Build Tools 36.0.0.

Run `python scripts/android.py check` from the repository root for phone/watch debug builds, unit tests, lint, and instrumentation APK compilation. Instrumentation tests require a connected emulator or device. `NativeServerTest`, `NativeOfflineTest`, and the remote appearance check are opt-in tests using the disposable backend provided by `scripts/native_android_test.py`.

Run `python scripts/android.py build` to build signed release APKs using the existing signing configuration. Retain the same signing key for compatible updates. The helper also exports the public app association for compatibility with older clients; the native phone runtime does not depend on browser association.

Implementation details, verification results, upgrade behavior, and remaining device checks are in [the native Android handoff](../../docs/handoffs/native-android.md).
