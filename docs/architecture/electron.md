# Phase 10 — Electron desktop shell (partial)

## Implemented

- `apps/electron/src/main.ts` creates a desktop window around the existing web renderer. The renderer is built with relative asset paths and `HashRouter` for packaged use; ordinary web builds retain browser history routing.
- Production renderer assets are served from a registered `landexpert://app` standard/secure custom protocol. The handler allows GETs for resolved files beneath the renderer build directory only; requests outside it are rejected. The development server is limited to the fixed loopback URL `http://127.0.0.1:4173/` (or `localhost` on the same port).
- BrowserWindow uses `contextIsolation`, `sandbox`, and `webSecurity`; `nodeIntegration` is off, insecure content is disabled, and no preload or IPC bridge is exposed. Renderer navigation is restricted to the expected app document. Popups are denied; only public HTTPS links may open in the system browser. `webview` attachment is denied.
- An Electron-only Content Security Policy is emitted by the Vite build. It allows bundled assets, the app's required inline styles, data/blob images, HTTPS service/map requests, and blob workers; it blocks frames and plugins.
- Electron permission handlers deny requests by default and allow only geolocation from the main frame of the trusted app origin. The app's existing GPS control requests location only after user action. Actual OS prompts, GPS and device privacy behavior remain unverified.
- Cloud sign-up is disabled in Electron because confirmation deep links are not configured; existing accounts can sign in. A localized notice explains this.
- Cross-platform scripts: `npm run build:electron` builds renderer and main process; `npm run electron` starts the built app; `npm run electron:dev` builds and launches Vite plus Electron.

## Verification

`apps/electron/src/security.test.ts` has four unit tests for the development URL allowlist, app navigation/origin restrictions, external HTTPS link policy and trusted-origin recognition. `npm run typecheck` passes including Electron main-process types. `npm run build:electron` passed and its generated output was inspected: asset URLs are relative, the CSP meta tag is present, and the public `map-catalog.json` is copied into the renderer root. The static file’s presence is build-verified; serving it through Electron’s custom protocol remains runtime-unverified. The Electron package was installed with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` because this sandbox has no approved Electron runtime download endpoint; the native Electron binary is absent. Therefore the main process has **not** been launched and no native window, protocol handler, permissions, geolocation, local IndexedDB persistence, file chooser/download, sleep/resume, or OS integration has been exercised.

## Incomplete / not production-ready

- No installer/app bundles are produced. `electron-builder`/Forge, Windows/macOS/Linux packaging, icons, code signing/notarization, updates, crash reporting, auto-launch, and release pipeline are not configured.
- No physical desktop testing, hardware GPS, keyboard/screen-reader evaluation, multi-display/window restore, DPI scaling, file associations, or secure deep-link auth callback is verified. Cloud account creation must happen on the web app first.
- Browser-local project storage under the custom app origin needs persistence/quota/recovery tests. The app still stores survey projects locally; there is no native secure-store integration.
- Cloud backups and licensing remain at the documented Phase 7–9 boundaries; no secrets are embedded in the desktop bundle.
- Platform support matrix, app identifier, signing identity and minimum OS/Electron update policy have not been specified. No installer or production desktop release is available.
