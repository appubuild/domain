# Android debug APK device-acceptance runbook

This runbook is for manual verification of the unsigned debug APK produced by the non-publishing release gate. It is **not** a release, store package, signing artifact, or production acceptance. Use a synthetic project and test account; do not capture real land records or credentials in screenshots/logs.

## Obtain the APK for the exact commit

1. Open the PR's **Build and full test gate** run in GitHub Actions. Confirm that **Build Android debug APK** and **Upload Android debug APK for device testing** passed.
2. Download the `landexpert-android-debug-<commit-sha>` artifact from that run's **Artifacts** section. Artifacts expire after seven days. Use the artifact from the exact commit under test, not a later or unrelated run.
3. Or use GitHub CLI:

   ```sh
   gh run download <run-id> \
     --name landexpert-android-debug-<full-commit-sha> \
     --dir /tmp/landexpert-android-debug
   ```

   Check that `/tmp/landexpert-android-debug/app-debug.apk` exists. The package id is currently provisional: `com.appubuild.landexpert`.

## Install and launch

Connect an emulator or device with USB debugging enabled, then:

```sh
adb devices
adb install -r /tmp/landexpert-android-debug/app-debug.apk
adb shell monkey -p com.appubuild.landexpert 1
```

If Android refuses an update because an already-installed copy has a different debug signing key, record that result first. Uninstalling the old package removes its local app data; only do so when that data is disposable.

## Acceptance checks

Record device model, Android/API version, app artifact commit, installation result, language, and pass/fail for each check. File issues for failures; do not silently waive them.

- **First launch and language:** app starts; switch EN/BN; controls, errors, and long labels remain usable.
- **Location permissions:** test precise grant, approximate grant, deny, deny-and-ask-again, revoke in system settings, and system location disabled. GPS runs only after the explicit locate action; accuracy and failure state are visible; no background permission is requested.
- **Local data:** create a synthetic project, close/relaunch the app, and verify it remains readable. Rename, duplicate, export, import and restore a synthetic backup; confirm conflicts do not overwrite existing projects. Do not treat this as encryption or backup durability evidence.
- **Files and lifecycle:** exercise file selection/download, app background/resume, process recreation, keyboard, back navigation and screen rotation. Record unsupported or OS-version-dependent behavior.
- **Network and security:** verify the configured HTTPS app origin and that cleartext is not used. Test online map failure and return to the offline grid without losing the synthetic drawing.
- **Layout and accessibility:** inspect portrait and landscape at representative narrow/medium/wide device sizes, including 320, 375, 430, 768, 1024, 1366 and 1920 CSS px where the device/emulator supports them; verify touch targets, keyboard/focus order and screen-reader labels.
- **Account flow:** verify existing-account sign-in is available and native sign-up remains disabled pending verified confirmation links.

## Evidence and limits

Keep a concise result matrix (device/API, commit, test, result, issue reference). Use only synthetic data. A CI debug APK compile proves buildability only; it does not establish runtime, permissions, accessibility, persistence, privacy, security, signing, or Play policy compliance. Phase 11 remains partial until the applicable device matrix and upstream release requirements pass.
