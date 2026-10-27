# Phase 14 — Deployment & production readiness

Date: 2026-10-27 · Branch `arena/b181432b-domain` · Host: **Vercel** (`domainfits.vercel.app`)
· Supabase project `bjbbrgjiyoquacoypsia`

Everything below is separated into **verified** (observed from outside the repository, or
reproducible by a command in the repo) and **asserted** (true by construction, but not observed).
Anything that only the owner can do is listed in [`deployment.md`](deployment.md) §10 rather
than quietly dropped.

---

## 1. What this phase added

| Area | Change | Where |
| --- | --- | --- |
| Public surface hardening | The availability function now reflects only allowlisted origins, applies a per-caller rate limit, refuses to cache transient failures, collapses concurrent lookups of one name, and never fails a lookup over a malformed `URL` | `supabase/functions/availability/index.ts` |
| Deployability of the function code | `npm run typecheck:functions` type-checks all three Edge Functions with `tsc` against a Deno stub (there is no `deno` binary in this environment) and is part of `npm run verify` | `scripts/typecheck-functions.ts`, `supabase/functions/_shared/deno-stub.d.ts` |
| Testability of the deployed code | The function is one self-contained module whose policy and handler are exported, so the ordinary vitest suite tests **the file that is deployed**, not a copy | `tests/availability/edge-policy.test.ts` (23 tests) |
| Headers on the host that ignores `.htaccess` | Committed `vercel.json`: full non-CSP header set, the enforcing CSP subset, the full policy as report-only, immutable caching for hashed assets | `vercel.json`, `tests/security/vercel-headers.test.ts` (5 tests) |
| Release fingerprint | `redirects.json` carries a `build` manifest: app URL, canonical host, Supabase origin, which optional functions this build will call, ads on/off, commit | `scripts/lib/hosting-config.ts` → `buildManifest()` |
| Post-deploy verification | `npm run smoke` serves `out/` itself or a live URL, then checks routes, 404s, headings, third-party requests, sitemap/robots/redirects, trailing slashes, security headers and the build manifest | `scripts/smoke.ts` |
| Runbooks | Env matrix, function runbook with real commands, recorded rollback drill, domain cutover, operator TODOs | `docs/deployment.md` §1–§10 |

## 2. Verified

**Function, on the wire** (probed from Supabase's own egress, since the sandbox has no general
internet access):

| Probe | Result |
| --- | --- |
| `GET …/availability?domain=google.com` | `200`, `status: registered`, `confirmed: true`, `cached: true` |
| `GET …/availability?domains=a_bad,a_bad,also_bad` | **two** results for three inputs — duplicate collapse proves v4 is the code running |
| `Origin: https://domainfits.vercel.app` | `access-control-allow-origin: https://domainfits.vercel.app` |
| `Origin: https://evil.example` | `access-control-allow-origin: https://domainfits.vercel.app` (not reflected) |
| 65 concurrent requests from one client | all `200`, no `429` — see §4 |

**Build manifest, live on production:** `source: supabase`, `build.commit: 5e56c16…`,
`build.integrations.availabilityFunction` set, `affiliateFunction`/`aiFunction` `null`,
`adsEnabled: false`.

**Rollback drill (run, not rehearsed):** production was re-deployed from the previous release
(`1578bba`), reached READY/PROMOTED in 53 s, and the alias was verified to serve the older
artifact (no `build` key, `source: supabase`, CSP present). Production was then restored to the
current build (`321fe31`, READY in 55 s) and the manifest reappeared with the new commit. Full
table: [`deployment.md`](deployment.md) §8.1.

**Security headers on the live host:** observed on `https://domainfits.vercel.app/` from a second
network — `content-security-policy`, `content-security-policy-report-only`, `strict-transport-security`,
`x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`,
`cross-origin-opener-policy`, `cross-origin-resource-policy`.

**Admin data reality:** `auth.users` = 1 (`info@appobuild.com`, confirmed), `role_grants` = 1
(`owner`); `app_roles` = viewer 20 / editor 50 / admin 80 / owner 100. The first-admin TODO is
satisfied; storing the password is not, and cannot be, done here.

**Gates:** `tsc` 0 · `npm run typecheck:functions` 3/3 · vitest **779 passing / 34 files** ·
build exit 0 · `npm run smoke -- --dir out` → 31 passed, 1 warning (security headers, expected:
the local server emits none), 0 failures.

## 3. Asserted, not verified

- **The rate limit.** The unit test proves the code returns `429` with `Retry-After` once a
  caller exceeds the window. The live probe did not: 65 concurrent requests all succeeded because
  the platform spread them across isolates, and the counter lives in isolate memory. It is a
  speed bump, not a quota — the Postgres cache is what actually bounds registry traffic. Documented
  as such in `deployment.md` §5.
- **Nothing.** The CSP on the live host was initially in this list; it is now verified. After the
  restore deployment (`dpl_9SACDoR1LzRPZbn4PGX4bTbKez2C` @ `321fe31`), a request to
  `https://domainfits.vercel.app/` made from Supabase's egress returned:
  `content-security-policy` (the enforcing subset), `content-security-policy-report-only` (the full
  policy, byte-identical to the one in `redirects.json`), `strict-transport-security`,
  `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy`. Vercel no
  longer serves an unprotected response.
- **The full CSP.** It ships report-only: `script-src 'self' 'unsafe-inline'` is unavoidable in a
  static export (Next inlines its hydration bootstrap; a nonce needs a server), so the policy is
  useful but not yet enforceable without watching a browser console. Promotion is TODO #7.

## 4. Deliberate limitations

1. **Edge functions are single files.** They are deployed through the Management API with one
   source string, so a relative import would not travel with them. The policy therefore lives at
   the top of `index.ts` — which is what makes it testable at all, since the test imports the same
   module.
2. **`verify_jwt: false` on `availability`.** A static site cannot sign requests. The mitigation
   is an origin allowlist (browser-side only: `curl` ignores CORS) plus the cache. Anything that
   writes must keep JWT verification on — `ai-studio` is specified that way.
3. **Ads and affiliate stay off.** Not a Phase 14 regression: both are product decisions with
   prerequisites (publisher ID, consent flow, partner accounts) listed in §10.
4. **Vercel's `vercel.json` cannot be generated per build** (it is read before the build), so its
   CSP is a hand-maintained copy of the production policy. A test keeps the rest in sync and
   constrains what the enforcing header may contain; the ad-origin conditional cannot be
   reproduced there and is documented.

## 5. Where to go next

- Promote the report-only CSP after a week of clean console reports (§10 #7).
- Deploy `ai-studio` the moment a provider key exists (§10 #1) — it is the last feature in the
  brief that is built but not shipped.
- If availability traffic ever grows beyond a hobby site, move the rate limit from isolate memory
  to a table or Upstash: the current limit is honest but weak, and it is the only thing standing
  between the endpoint and a scraper with no cache hits.
