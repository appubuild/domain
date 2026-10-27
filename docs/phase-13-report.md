# Phase 13 — Security, performance, accessibility

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Live:** <https://domainfits.vercel.app>

The brief for this phase is a gate, not a feature: before the site is considered deployable it
should get a hardened header policy, measurable performance, and an accessibility claim that is
tested rather than asserted. What follows separates *verified here* from *still opinion* —
because the failure mode for this kind of phase is a checklist of ticks nobody re-ran.

```
tsc --noEmit        clean
vitest run          747 tests / 32 files       (was 456 / 26)
npm run build       exit 0, ✓ Exporting (2/2)
npm run audit:size  every route inside budget (heaviest 687 kB raw / 199 kB gzip)
npm audit           0 vulnerabilities          (was 2)
axe-core            64 pages, 0 violations     (WCAG 2.0/2.1 A+AA + best practice)
```

---

## 1. Security headers, generated instead of promised

A static export has no middleware, so the header policy has to be written as files the host
reads. `scripts/emit-redirects.ts` became `scripts/emit-hosting-config.ts` and now emits three
artefacts after `next build`:

| File | Host | Contents |
| --- | --- | --- |
| `out/.htaccess` | Apache / LiteSpeed | canonical-host redirect, DB redirects, security headers, cache policy, compression |
| `out/_headers` | Netlify / Cloudflare Pages | the same header set |
| `out/_redirects` | Netlify / Cloudflare Pages | the redirect rules |
| `out/redirects.json` | audit copy | rules **and** the emitted CSP, so the policy can be read from production without guessing |

The policy, with Supabase configured and advertising off:

```
default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'none';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self';
manifest-src 'self'; worker-src 'self' blob:; upgrade-insecure-requests
```

Decisions worth naming:

- **`'unsafe-inline'` in `script-src` is a real limitation, and the honest one.** Next inlines
  its hydration bootstrap into every page; a nonce needs a server to generate it per response.
  The policy still forbids every third-party script, blocks inline event handlers with
  `script-src-attr 'none'`, and closes `object-src`, `base-uri` and `frame-ancestors`.
- **`connect-src` names one API.** No wildcard, no `https:`. The Supabase origin comes from the
  build environment, so it is the real project, not a placeholder.
- **Ad origins are conditional on `ad_settings.global_enabled`**, read at build time. If that
  read fails, no Google origins are written — a policy that quietly permits an unused ad network
  is worse than one that fails visibly.
- **HSTS only when `NEXT_PUBLIC_APP_URL` is https.** Sending it from a host without a
  certificate would lock visitors out of the http fallback.
- **`frame-ancestors 'self'`** — the admin must not be frameable. If you ever embed the site
  somewhere, that line, not the design, is what stops you.

### What is *not* verified

No Apache, LiteSpeed, Netlify or Cloudflare instance exists in this environment, so the headers
have been **generated and asserted, not observed on the wire**. The tests check the text that
will be served (single occurrence per header, no empty directives, no wildcards, quoted values);
they cannot prove the host applies it. `docs/deployment.md` §2 gives the two `curl -sI` commands
that close that gap in a minute once the build is on the PHP host.

Vercel, the current preview/production host, **ignores both files** — that is documented in
`docs/deployment.md` §4 rather than papered over.

---

## 2. Performance: measured, then left mostly alone

`npm run audit:size` (new, `scripts/audit-bundle.ts`) reads the `<script>` and `<link>` list out
of each prerendered HTML file and sums the actual bytes, raw and gzipped. That is what a browser
fetches before it can interact — no bundler report, no estimate.

| Route class | Raw JS | gzip |
| --- | --- | --- |
| Public content page (`/about/`, `/faq/`, …) | 396 kB | 120 kB |
| Generator | 541 kB | 164 kB |
| Admin (heaviest: `/admin/monetization/`) | 687 kB | 199 kB |
| CSS, every route | 42 kB | ~7 kB |

Two findings, one of them a **measurement bug worth more than an optimisation**:

1. **The audit was counting the polyfill bundle.** `polyfills-*.js` is 112 kB and carries
   `noModule`, which every current browser ignores. Including it inflated every route by ~28 %
   and would have hidden a genuine 100 kB regression inside a fake one. Excluded now, and the
   test suite asserts the exclusion so it cannot creep back.
2. **Nothing else was worth changing.** The remaining weight is React 19 plus the Next client
   runtime; it is the floor for this architecture, and the "fix" (server rendering) is forbidden
   by the brief. The admin pages add the 180 kB Supabase client, but only after auth, and the
   public pages already load it lazily — `recordEvent` dynamic-imports it so a page-view counter
   never costs a first paint.

Where the performance win actually is, for the real target host: **caching and compression**.
Next content-hashes every asset, so `_next/static` is served `max-age=31536000, immutable`,
HTML revalidates, and `mod_deflate` compresses JS/CSS/HTML/SVG. On shared PHP hosting those two
lines are worth more than any code change in this phase.

Budgets live in `scripts/audit-bundle.ts` (`BUDGETS`) and are asserted in
`tests/perf/bundle.test.ts` — 720 kB raw / 210 kB gzip / 90 kB CSS per route. They are set a
little above today's numbers on purpose: they exist to catch an accidental heavy import, not to
force a rewrite.

---

## 3. Accessibility: three kinds of evidence

### a. axe-core over every built page — 64 pages, 0 violations

`tests/a11y/pages.test.ts` loads each file in `out/` into jsdom, injects axe 4.14, and runs
WCAG 2.0 A/AA, WCAG 2.1 A/AA and the best-practice ruleset. Results are per-page tests, so a
failure names the route and prints the offending markup.

### b. Contrast computed from the tokens — two real defects found

axe cannot evaluate contrast in a headless DOM (no layout, no paint), so `tests/a11y/contrast.test.ts`
parses `globals.css` and computes WCAG ratios arithmetically for every text-on-surface pair in
both themes. That found what a browser-less review would have missed:

| Token | Before | Ratio | After | Ratio |
| --- | --- | --- | --- | --- |
| `--fg-subtle` (light) | `#79828f` | 3.28:1 ✗ | `#5f6874` | 4.76:1 ✓ |
| `--fg-subtle` (dark) | `#77818e` | 3.95:1 ✗ | `#8b95a2` | 5.15:1 ✓ |
| `--border-strong` (light) | `#cbcbc4` | 1.38:1 ✗ | `#7d7d76` | 3.50:1 ✓ |
| `--border-strong` (dark) | `#38404b` | 1.49:1 ✗ | `#6b7686` | 3.39:1 ✓ |

The first two are text at 11–13 px — eyebrows, table terms, metadata — which needs 4.5:1 and had
3.3–3.9:1. **The border one is the more interesting failure**: `--border-strong` is the only
visual boundary of every text input, select and outline button, and it sat at 1.4:1 against the
surface behind it. WCAG 1.4.11 asks 3:1 for exactly that. Because the fields are white on an
almost-white page (1.03:1), a keyboard or low-vision user had no way to see where the field
started. Fixed in the tokens, so the fix reaches every screen at once rather than one component
at a time. `--fg-muted` was darkened in the same pass to keep three distinguishable text levels
— a contrast fix that collapses hierarchy is a different bug, and a test now guards against it.

### c. Structural assertions axe treats as "incomplete"

axe marks a missing `<h1>` or a missing skip-link target as *incomplete* rather than a violation,
because script could add them later. In a static export the HTML *is* the page, so
`tests/a11y/structure.test.ts` asserts it directly, per page: exactly one `<h1>`, `<html lang>`,
an `id="main"` target, the skip link appearing **before** the nav, no positive `tabindex`, no
`autofocus`, and every `<nav>` carrying an accessible name. 195 assertions, all passing.

One fix came out of writing them: the admin shell's *loading* and *unconfigured* states rendered
no heading at all, so an admin page read by a screen reader before hydration had no name. Both
states now carry a visually hidden `<h1>` and the loading state is a `role="status"` live region.

### What is still not tested

No browser binary exists in this environment, so: no keyboard-only traversal, no focus-trap
verification inside dialogs (the traps are hand-written, see phase 1), no screen-reader phrasing
review, no Lighthouse score. Those are listed as open in `docs/security.md` §9 rather than
implied by the green ticks above.

---

## 4. Dependency audit cleared

`npm audit` reported two advisories, both inside Next's bundled `postcss@8.4.31` (CSS stringify
XSS, source-map path traversal). Next 15.5.28 is the newest 15.5 backport, so the upgrade path
was a major version jump — disproportionate for a build-time-only issue. Instead an npm
`overrides` entry pins `postcss` to `^8.5.32` inside Next:

```json
"overrides": { "next": { "postcss": "^8.5.32" } }
```

`npm audit` now reports **0 vulnerabilities**, and the build output is unchanged in shape — same
routes, same CSS bytes. Recorded honestly in `docs/security.md` §9: the audits are not asserted
in the test suite, because the advisory database is remote and such a test fails for reasons
that have nothing to do with this code.

---

## 5. Verified on the live deployment

Deployment `dpl_8ct5KdNmxw3k9nD4NWBXCmE9sdXv` @ `1578bba` went READY/PROMOTED, and the emitted
policy can be read back from production itself:

```json
GET https://domainfits.vercel.app/redirects.json
"headers": {
  "contentSecurityPolicy": "default-src 'self'; script-src 'self' 'unsafe-inline';
   script-src-attr 'none'; … connect-src 'self'
   https://bjbbrgjiyoquacoypsia.supabase.co wss://bjbbrgjiyoquacoypsia.supabase.co; …",
  "adsAllowed": false,
  "note": "ads are off; ad origins omitted"
}
```

That single file proves three things that could otherwise only be asserted: the emitter ran
inside the real build, `connect-src` names the real project rather than a placeholder, and the
ad origins really are conditional — `ad_settings.global_enabled` is false in production, and no
Google origin appears in the policy.

Pages spot-checked after promotion: `/`, `/faq/`, `/generator/`, `/blog/`. GitHub Actions-style
CI does not exist here; `npm run verify` is the gate, run locally and recorded above.

## 6. Files touched

```
scripts/emit-hosting-config.ts        # new: replaces emit-redirects.ts, emits headers + caching
scripts/lib/hosting-config.ts         # new: pure CSP/htaccess/_headers builders
scripts/audit-bundle.ts               # new: per-route first-load weight, with budgets
src/app/globals.css                   # four token fixes (contrast)
src/components/admin/admin-shell.tsx  # heading + live region in loading/unconfigured states
package.json                          # audit:size, test:a11y; verify now builds then audits
tests/a11y/pages.test.ts              # new: axe over 64 built pages
tests/a11y/contrast.test.ts           # new: WCAG ratios from the design tokens
tests/a11y/structure.test.ts          # new: headings, landmarks, skip link, focus order
tests/perf/bundle.test.ts             # new: budget assertions
tests/security/hosting-config.test.ts # new: policy and header correctness
tests/security/secrets.test.ts        # new: credential markers, third-party origins
docs/security.md                      # §8 headers and CSP, §9 gaps re-stated
docs/deployment.md                    # hosting config, caching, and the Vercel caveat
```

`npm run verify` is now `typecheck → test → build → test:a11y`. The order matters: the a11y and
perf suites audit the artefact, so they run after the build rather than against a stale `out/`.
