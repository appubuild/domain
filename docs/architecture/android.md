# Phase 11 — Android shell (partial)

## Current setup

- Capacitor 8 wraps the existing responsive, bilingual React renderer. The generated native project is in `android/`; `capacitor.config.ts` currently uses the provisional package id `com.appubuild.landexpert`. The generated template currently sets min SDK 24, compile/target SDK 36 and default Capacitor launcher/splash artwork. These are scaffolding defaults, not agreed product support or branding decisions. Confirm the durable application id before release because changing it later changes the Android app identity.
- The web output remains `apps/web/dist`. Run `npm run android:sync` to type-check, generate the regular production renderer with native CSP enabled, and run `cap sync android`. This copies the web assets and registers Capacitor plugins. `npm run android:open` opens the project in Android Studio; `npm run android:run` asks Capacitor/Gradle to build and install to an attached device/emulator. The latter two require a compatible Android Studio/JDK, Android SDK and device/emulator, none of which was available in the implementation sandbox.
- The Android local origin is HTTPS (`androidScheme: 'https'`); Capacitor cleartext is off and the Android manifest sets `usesCleartextTraffic="false"`. The native renderer CSP is restrictive and permits same-origin assets plus required HTTPS service/map calls. The app manifest sets `android:allowBackup="false"` as an opt-out from standard Android app backup because survey projects may contain sensitive land data; device-to-device and OEM behavior still needs verification. This is not encryption at rest; local project data and IndexedDB recovery have not been tested on Android.
- `@capacitor/geolocation` is used only when Capacitor reports a native platform. On the user's existing GPS action, it checks permission, requests `location` only if neither precise nor approximate permission is granted, then performs a one-shot fix. Approximate permission is accepted and accuracy remains visible. Browser geolocation remains the web fallback. Only coarse/fine foreground permissions are declared; no background location access is requested.
- Cloud sign-up is disabled on native Android until an app-link/deep-link email confirmation flow is implemented and verified. Existing-account sign-in remains available. Sign-up remains available in the ordinary web build.

## Verification and boundaries

`npm run android:sync` passed in the sandbox. A static smoke check verified the generated HTML CSP, copied `map-catalog.json`, geolocation plugin registration, location permission declarations, HTTPS scheme, cleartext disabled and backup disabled. This is a web bundle + Capacitor sync check only; it is not a Gradle build, APK, installation, emulator test or device test. The sandbox had no `java`, Android SDK environment variables, or `adb`; native Gradle compilation and runtime testing could not be performed.

Unit tests exercise the permission flow (first grant, approximate grant, denial), native/browser error mapping and the UI boundary that allows sign-in while disabling native sign-up. They do not emulate Android system permission dialogs, actual GPS, permission revocation/settings, WebView behavior, or file handling. WebView IndexedDB persistence, retention, quota and restore; chooser, downloads and imports; lifecycle/resume; orientation/keyboard behavior; browser history/back handling; accessibility; and physical device/browser compatibility all need native verification. No Android viewport screenshots were taken at 320, 375, 430, 768, 1024, 1366 or 1920 px, or in landscape.

## Not configured / not production-ready

- No final package id decision, custom launcher/splash assets, versioning policy, release build, APK/AAB, signing key, Play App Signing, store listing, automated release, crash reporting or update process.
- No Android App Links / email confirmation callback, OAuth redirect handling, password recovery, secure token-storage design or native authentication lifecycle.
- No policy/data-safety review, privacy disclosures, backup/recovery acceptance or determination of supported devices/API versions. System backup is disabled, but local data is not encrypted by this work.
- No offline basemap cache or promise of offline cloud/GPS features. The default grid is local; online maps and Supabase require network access.
- No Play Store policy, target SDK, accessibility, keyboard, performance, thermal/battery, location accuracy or multi-device testing.

Phase 11 remains partial until native builds and the device acceptance matrix are exercised. See [`phase-status.md`](../phase-status.md) for the exact verification, test results, viewport coverage and next acceptance criteria.
