# Noted for Android

An installable APK that opens your hosted Noted server through a Chrome Trusted Web Activity. Your server supplies the interface; Chrome handles uploads, downloads, and video playback. Native Firebase messaging handles Android notifications when configured. Android 8.0 or newer and an up-to-date compatible browser are required. Chrome is recommended.

The desktop setup wizard offers an optional Android notifications step for an owner's Firebase project. It includes console links, the exact Android package name, and import/paste fields for `google-services.json` and a service-account JSON from the same project. The key is sent over verified SSH and stored privately on that owner's VPS, outside content backups and desktop installation history. Existing owners can configure this through **Settings > Notifications > Android setup** over HTTPS. Skipping setup leaves browser Web Push available.

The same APK loads the selected server's public Firebase configuration during authenticated pairing. No rebuild is needed for another server or Firebase project. Private service-account keys stay on the VPS and are never sent to the phone or packaged with the app. FCM itself is free; this flow needs no Cloud Functions, paid Firebase plan, or shared relay.

If setup was skipped, open **Settings > Notifications > Android notifications**. The guide and JSON import fields are available there. Android controls stay greyed out until configuration is saved. After setup, the guide disappears and the connected project is shown instead; **Change project** reopens setup with empty credential fields. **Send notifications to Android** controls native phone delivery separately from browser notifications.

## For server owners and phone users

1. Install the current Noted server release through the desktop installer, or update an existing server. Use your HTTPS domain with a valid certificate.
2. Install the signed `app-release.apk` on the phone. Allow installation from the file app or browser you used to download it.
3. Open Noted and enter your server domain. The app checks the server's public Digital Asset Links file against its installed signing certificate, then opens the server in Chrome without a browser toolbar.
4. Sign in with your existing username and password.
5. Tap **Enable** after signing in, or use **Settings > Notifications > Enable notifications**. Accept the Android notification permission. Permission is requested when enabling notifications, not at first launch.
6. Schedule a reminder, put the phone app in the background, and unfocus Noted on desktop. Native notifications include the project, channel, content, and Done/Snooze actions that work without opening Chrome. Planned activities offer Start, an inline delay reason, and More options for other delays and activities.

Native pairing issues a restricted device credential bound to your signed-in session. Android stores it encrypted through the Android Keystore. Signing out that session revokes its access. Notifications must match the selected origin, Firebase project, and sender; switching server clears the previous native binding.

The server automatically creates its own VAPID signing key and stores only its own device subscriptions. Each server origin has separate browser cookies, storage, push permission, and subscription encryption keys. A subscription is bound to that server's VAPID key by the push provider. Sending from one VPS does not broadcast to other servers' users.

With Firebase configured, the VPS sends directly to FCM using its own service account. Otherwise it sends encrypted Web Push to the browser's push provider. Network access is required; these are not offline exact alarms. Force-stopping the delivery app, disabling notifications, or aggressive device battery restrictions can prevent or delay delivery.

When the browser verifies app/domain association and supports delegation, it displays notifications under Noted. Otherwise browser notifications or a Custom Tab toolbar may be used. The app reports a missing or mismatched server association rather than bypassing HTTPS or verification.

**Switch server** in Noted settings removes this server's push subscription, unsubscribes the browser, signs out, and opens the native server selector. Choosing a domain directly in the native selector does not erase Chrome's other site sessions. Notifications for any site you previously enabled remain manageable in that site's Noted settings or Chrome site permissions.

If you installed the earlier debug APK, uninstall that APK once before installing the release-signed APK. They use different signing certificates. Notes and uploaded files remain on the VPS; sign in again afterward.

## Build and distribute

Requires Python, JDK 17 or 21, Android SDK Platform 36, and Build Tools 36.0.0. Android Studio can install the SDK. Set `JAVA_HOME` and `ANDROID_HOME` when needed. The build helper also detects this workstation's installed Android JDK/SDK.

From the repository root:

```powershell
python scripts/android.py build
npm --prefix apps/web run build
```

The first command builds a signed APK, runs unit tests and lint, and writes the public verification file. Output:

- `apps/android/app/build/outputs/apk/release/app-release.apk`
- `apps/web/public/.well-known/assetlinks.json`

The second command copies the verification file into the web build. Build and deploy the web image from that same source when distributing the APK. This file contains only the package name and public certificate fingerprint, and is identical across servers using that APK. The server image ships it automatically at `https://YOUR_DOMAIN/.well-known/assetlinks.json`. Owners do not register their domains with a third-party console.

The helper creates a private signing key and configuration under `.local/android/` on the first release build. Back up **both** `noted-release.jks` and `signing.json` securely. Keep the same key for future builds so APK updates install in place. No password or private key is written to the public verification file. Increase `versionCode` in the Android build file for future releases.

For managed signing, set `NOTED_ANDROID_KEYSTORE`, `NOTED_ANDROID_KEY_ALIAS`, `NOTED_ANDROID_STORE_PASSWORD`, and `NOTED_ANDROID_KEY_PASSWORD`. The helper uses those credentials instead of creating a key. Do not put them in source control or public build logs.

After distributing an APK, retain its certificate fingerprint in the server association file while supporting that client. Signing-key rotation requires deliberately trusting the new public fingerprint and deploying an overlapping association file before changing clients.

Install over USB:

```powershell
adb install -r apps/android/app/build/outputs/apk/release/app-release.apk
```

## Checks and structure

```powershell
python scripts/android.py check
```

With a phone or emulator connected, use `gradlew.bat :app:connectedDebugAndroidTest` from `apps/android`. Debug APKs use a different signing certificate, so they need a development server with its corresponding public association file for complete TWA tests. Do not add debug certificates to a public production deployment.

- `connection/`: HTTPS origin validation, native server selector, installed app certificate checks.
- `web/BrowserSession.kt`: the Android Browser Helper TWA session.
- `notifications/`: native Firebase registration, encrypted device credentials, notification actions and retries, plus Chrome notification delegation for Web Push fallback.
- `MainActivity.kt`: connection lifecycle and safe routing to the selected origin.
- `scripts/android.py`: release signing, public certificate export, build and validation.

The Android app does not read Chrome cookies or receive SSH credentials. Pairing uses a short-lived, single-use ticket from your authenticated web session, checked against the selected HTTPS origin and its app association. External links are handled by the browser. A notification or deep link cannot silently change the configured server.

Reference documentation: [Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity/), [domain verification](https://developer.chrome.com/docs/android/trusted-web-activity/multi-origin), [notification delegation](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/android/java/src/org/chromium/chrome/browser/browserservices/permissiondelegation/README.md), and [VAPID](https://www.rfc-editor.org/rfc/rfc8292).
