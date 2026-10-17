# Noted for Android

An installable APK that opens your hosted Noted server through a Chrome Trusted Web Activity. Your server supplies the interface; Chrome handles uploads, downloads, video playback, and background Web Push. Android 8.0 or newer and an up-to-date compatible browser are required. Chrome is recommended.

No server owner needs a Firebase account, service-account key, API key, or notification relay. Firebase JSON files from the earlier client are no longer used. Keep any downloaded private keys private; this build neither packages nor uploads them.

## For server owners and phone users

1. Install the current Noted server release through the desktop installer, or update an existing server. Use your HTTPS domain with a valid certificate.
2. Install the signed `app-release.apk` on the phone. Allow installation from the file app or browser you used to download it.
3. Open Noted and enter your server domain. The app checks the server's public Digital Asset Links file against its installed signing certificate, then opens the server in Chrome without a browser toolbar.
4. Sign in with your existing username and password.
5. Tap **Enable** after signing in, or use **Settings > Notifications > Enable notifications**. Accept the Android notification permission. Permission is requested when enabling notifications, not at first launch.
6. Schedule a reminder, put the phone app in the background, and unfocus Noted on desktop. The notification includes the project, channel, content, and Done/Snooze actions. Those actions open the relevant note and use your authenticated server session.

The server automatically creates its own VAPID signing key and stores only its own device subscriptions. Each server origin has separate browser cookies, storage, push permission, and subscription encryption keys. A subscription is bound to that server's VAPID key by the push provider. Sending from one VPS does not broadcast to other servers' users.

The VPS sends encrypted Web Push directly to the browser's push provider. On Chrome for Android, this still uses Google's push infrastructure internally, but server owners do not configure Firebase. Network access is required; this is not an offline exact alarm. Force-stopping Chrome or Noted, disabling notifications, or aggressive device battery restrictions can prevent or delay delivery.

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
- `notifications/NotedDelegationService.kt`: Chrome notification delegation using its verified browser token.
- `MainActivity.kt`: connection lifecycle and safe routing to the selected origin.
- `scripts/android.py`: release signing, public certificate export, build and validation.

There is no JavaScript-to-native credential bridge. The Android app does not read your Chrome cookies or receive SSH credentials. Authentication stays between the browser and the selected HTTPS server. External links are handled by the browser. The app accepts notification/deep links only for its currently selected origin; a link cannot silently change the configured server.

Reference documentation: [Trusted Web Activities](https://developer.chrome.com/docs/android/trusted-web-activity/), [domain verification](https://developer.chrome.com/docs/android/trusted-web-activity/multi-origin), [notification delegation](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/android/java/src/org/chromium/chrome/browser/browserservices/permissiondelegation/README.md), and [VAPID](https://www.rfc-editor.org/rfc/rfc8292).
