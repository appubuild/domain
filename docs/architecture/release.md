# Phase 12 — release readiness (partial; production release blocked)

## Release-facing work in this phase

- `vercel.json` applies `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and a narrowly scoped `Permissions-Policy` that permits same-origin geolocation but disables camera and microphone.
- `package.json` declares Node `>=22 <25`, covering the locally tested Node 22 and the connected Vercel project's configured Node 24, as well as Android/Capacitor tooling. A static-only `npm run release:check-config` verifies the Node declaration, Vercel build/output paths, SPA fallback and these required headers. It does **not** perform a deploy, inspect Vercel environment variables, or verify headers delivered from the edge.
- `.github/workflows/release-gate.yml` runs the static preflight, typecheck, web/Electron builds, Android sync, dependency audit and full test suite on PRs, pushes to this session branch, or manual dispatch. It does not publish or promote deployments. The full test step is intentionally a hard gate and will fail on the two currently deferred Bengali extraction regressions; they are not skipped or weakened.
- The Vercel project has an existing production alias `https://landexpert.vercel.app`. On 2026-10-29, Vercel reported its current ready production deployment at commit `bde220184b0c651b0bc4a89aca064215ec4637d2`, earlier than the current branch head. The project settings reported Git-provider deployment creation disabled. Repository changes are not deployed to that production alias.

## Verification

`npm run release:check-config`, `npm run typecheck`, `npm run build`, and `npm audit` passed; audit reported 0 vulnerabilities. The full `npm test -- --reporter=dot` run reported **110 passed, 2 failed**; both failures are the unchanged, user-deferred Bengali PDF logical-text extraction regressions. Builds retain existing Vite large-chunk and third-party annotation warnings. A non-production preview was manually requested from current branch commit `cd9b41fa08ba60308413b7ca34d39596b6c21875`. Vercel reports it **READY** at `https://landexpert-63aqv52eg-md-sobur-alis-projects-c5b69b29.vercel.app` (Node 24, preview environment, Vercel build completed); its generated route configuration includes the four headers. The deployment is protected (`public: false`), so account access is required. This verifies remote build and route configuration, not actual HTTP response headers or runtime/browser behavior. No production deployment was created or promoted during this work.

No UI layout or persistence code changed in this phase. Viewport widths 320, 375, 430, 768, 1024, 1366 and 1920 px, and landscape, were not re-tested in this infrastructure-only phase; this is not an accessibility or responsive acceptance result. Security changes apply to future Vercel responses; no live database, auth, licensing enforcement or native-device security behavior was tested.

Changed files: `.github/workflows/release-gate.yml`; `vercel.json`; `package.json`/`package-lock.json`; `scripts/release-config-check.mjs`; `README.md`; `docs/phase-status.md`; and this release note.

## Production blockers

A production release is deliberately blocked, not merely pending a deploy command:

- The failing Bengali PDF regressions remain an explicit release gate. Bengali PDF stays disabled; do not make the tests pass by weakening/reclassifying them or by integrating an unlicensed/unverified shaper. Resolve only with the required licensed shaping implementation and independent visual/extraction verification.
- Phases 3–11 are not complete. In particular, Phase 11 has no Android Gradle build or device run; Phase 10 has no Electron runtime launch or installer. Phase 4 has outstanding metadata/recovery/device acceptance.
- No live Supabase migration/auth/RLS verification, app-wide entitlement enforcement, billing, production security review, incident/restore playbook, data retention policy or approved production map provider is established.
- Android package id, target-device/API support, branded assets, app-link auth, release signing and store privacy/data-safety requirements are unsettled. Desktop identity, supported OS matrix, signing, updater and packaging are also unsettled.
- No deployment has been checked for runtime interaction, production CSP/headers, privacy/consent or support readiness after the latest repository changes.

Before production release, require green full tests and all applicable phase acceptance criteria; confirm product identity, supported platforms, privacy/retention and legal/provider terms; complete live backend and security review; verify the exact Vercel production configuration/headers without exposing credentials; then use an approved release process with a tested rollback and post-deploy smoke checks. A ready Vercel deployment state alone is not release acceptance.

Phase 12 remains partial. No production deployment or public release is authorized by this checklist.
