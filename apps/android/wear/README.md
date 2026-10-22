# Noted for Wear OS

Native Samsung-focused activity and reminder client, using the selected A01 Quiet list layout. It shares the server's global tracker, plans, reminders, and notification rules. It has no note capture.

The phone and watch apps use the same application ID and signing certificate so Google's Wearable Data Layer can deliver a short-lived pairing ticket to the selected watch. The watch exchanges it directly with the selected HTTPS server for its own scoped credential. Credentials are encrypted with Android Keystore, excluded from backups, and revocable from Settings > Sessions.

## Modules

- `wear`: native watch UI, HTTPS client, optional Firebase delivery, tracker tile, and complication data sources.
- `watchface`: internal resource-only Watch Face Format package, validated and embedded into the watch APK at build time. It has native 24-hour time, Noted content, and three editable edge slots. The layouts W07, W16, and W24 are selected in Noted Settings > Watch.
- `app`: phone client with the watch pairing screen.

## Use

Update the Noted server and phone APK together before pairing. Install only `wear-release.apk` on the watch, not the phone. Open Settings > Watch in the signed-in phone app and choose Pair watch, then select your watch. The watch can access the VPS using its available network connection after pairing.

On Wear OS 6 or newer, open Watch settings > Watch face inside the watch app and choose Install watch face, then Use watch face. The system requests permission before activation. The face installer also works before server pairing and requires no extra download. Future app builds offer Update watch face while preserving the existing face's configuration. On Wear OS 4 and 5, the native activity app works but the bundled face installer is unavailable.

Use the face's Customize screen to select edge providers such as steps, battery, or a compatible installed sleep provider. Sleep data is not collected by Noted. The default bottom edge is empty.

Firebase is optional for pairing and direct controls. Background notifications use the server owner's existing Firebase project and a separate watch token. No additional Firebase project is required. Phone notification mirroring is suppressed while a paired Noted watch is reachable, while the server continues to apply its desktop-focus rules.

Watch data is cached for display. Actions require a server connection and use revision checks; failed actions are not shown as successful. The running timer uses a local monotonic clock while the app is open. Complication elapsed time uses Wear OS time-dependent text. Periodic background sync is scheduled every 15 minutes and is subject to system power limits.

## Verification

`python scripts/android.py check` builds the phone, watch, and internal face, and runs phone/watch unit tests and lint. `python scripts/android.py build` signs the release builds. Gradle runs Google's Watch Face Push validator before embedding the exact APK and its validation token. Only phone and combined watch APKs are published as downloads. The face remains a separate resource-only package internally, as required by Watch Face Format.

`WatchUiTest` runs the real app in a disposable Wear OS 6 emulator, uses touch events to open activities, plans, reminders, and delay choices, and installs the bundled face through Watch Face Push. It captures Home, the activity picker, reminders, delay choices, settings, and all three native face layouts. Its test-only HTTPS fixture uses no real server or account and refuses to run on physical hardware. It is included only in the instrumentation APK.

After installing `wear-debug.apk` and `wear-debug-androidTest.apk` on the emulator, run:

```sh
adb -s emulator-5566 shell am instrument -w -e phase review com.noted.android.test/androidx.test.runner.AndroidJUnitRunner
adb -s emulator-5566 pull /sdcard/Android/data/com.noted.android/files/watch-ui/review
```

Use `-e text_scale 1.3` to check enlarged text. The emulator must have Noted selected as its face when rerunning captures; Wear OS limits repeated programmatic face activations. The display is checked at 454 × 454 (227 dp) and 384 × 384 (192 dp).

Physical Samsung watch testing is still needed for pairing, notification delivery, and third-party complication providers.
