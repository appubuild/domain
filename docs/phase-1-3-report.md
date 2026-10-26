# Phase 1–3 completion report

**Date:** 2026-10-26
**Branch:** `arena/b181432b-domain`
**Scope:** foundation, generation & intelligence engines, availability, data layer, public site,
admin panel.

This report is written against verified evidence from this environment. Anything that could
not be executed here is listed as **blocked**, with the reason and the command that will prove
it once the credentials exist. No result below is extrapolated.

---

## 1. Verification summary

| Gate | Command | Result |
| --- | --- | --- |
| Type safety | `npx tsc --noEmit` | **Pass** — exit 0, strict mode, `noUncheckedIndexedAccess` |
| Unit/integration | `npx vitest run` | **Pass** — 132 tests across 7 files |
| Static build | `npm run build` | **Pass** — `✓ Exporting (2/2)`, then redirect emitter |
| Deployment artifact | `ls out/` | **Present** — 21 HTML routes + `_next/`, `.htaccess`, `_redirects`, `redirects.json` |
| Browser E2E | Playwright | **Blocked** — no browser binaries in sandbox |
| Lighthouse | — | **Blocked** — same |
| Live RDAP | — | **Blocked** — egress allowlist blocks RDAP hosts |
| Supabase deploy | `supabase db push` | **Blocked** — no project URL, anon key or CLI link |

Test breakdown:

```
tests/engine/generate.test.ts        16 passed
tests/engine/constraints.test.ts     19 passed
tests/engine/normalize.test.ts       16 passed
tests/engine/export.test.ts          13 passed
tests/db/schema.test.ts              31 passed   (PGlite: real Postgres 18.6)
tests/availability/engine.test.ts    20 passed   (injected fetch)
tests/content/content.test.ts        17 passed
```

---

## 2. What is built

### Foundation
- Next.js 15 App Router, TypeScript strict, Tailwind v4 design tokens, light/dark theme with a
  no-flash bootstrap script.
- `output: "export"`, `trailingSlash`, unoptimised images — **no** SSR, API routes, server
  actions, middleware or ISR anywhere in the tree.
- UI kit: buttons, fields, switches, segmented controls, tag input, dialogs, drawers, toasts,
  tables, skeletons, empty states, pagination, breadcrumbs — all client-safe.

### Generation engine
- Multi-root keyword input, prefix/suffix/both/exact/flexible positioning, library and custom
  affixes, length rules, 12 word styles, grammar modes, industry selection, TLD selection.
- Target counts with **honest exhaustion reporting**: when the candidate space runs out, the
  UI shows requested vs. produced and why.
- Advanced filters (length, hyphens, digits, pronounceability, repeated letters, blocklists)
  live in `src/lib/generator/filters.ts` and are shared by UI, export and URL state.

### Domain Brain
- Normalisation → semantic expansion → industry detection → strategies A–G (including
  portmanteau, invented and AI-shaped candidates) → hybrid ranking.
- Brandable mode with profiles and versioned heuristic scoring; every result exposes its
  component scores and the weights used.

### Availability
- RDAP-first, no scraping. Status model: `available_verified`, `registered`, `unavailable`,
  `premium_or_special_pricing`, `unknown`, `check_failed`, `rate_limited`, `unsupported_tld`.
- Authoritative 404 → verified available; non-authoritative 404 → `unknown`; 429 →
  `rate_limited`; 400/422 → `unsupported_tld`; ≥500/timeout → `check_failed`.
- Concurrency 8, TTL 6 h (verified) / 10 min (inconclusive), results cached in Postgres.

### Data layer
- 6 migrations, **44 tables**, RLS enabled on every one, `is_admin()` guard, seed of 1,552
  lines (17 industries, 12 TLDs, 13 libraries, 8 pages).
- Validated against PGlite (real PostgreSQL 18.6 wasm build): constraints, policies and the
  RLS "silent zero-row update" behaviour are all asserted in `tests/db/schema.test.ts`.

### Public site (static)
- `/`, `/generator/`, `/industries/` + 17 landing pages, `/extensions/`, `/blog/` + articles,
  8 CMS pages, `robots.txt`, `sitemap.xml`, `404`.
- Build-time content snapshot with Supabase REST fallback; the page states which source it
  used. Canonicals and sitemap entries only exist when a canonical origin is configured —
  the build prints a warning when it is not, instead of inventing a host.
- JSON-LD for organisation, website, breadcrumbs, articles, application and *rendered* FAQs
  only; `<` is escaped so data can never close the script tag.

### Admin panel
- 23 modules in 10 groups, one declarative registry driving a shared CRUD manager (search,
  pagination, validation, confirm-before-delete, audit entry on every write).
- Settings, analytics and audit views. Analytics aggregates only stored events and says when
  a window is truncated.
- Auth through the provider; role gate via `is_admin()`; RLS is the real boundary.
- Redirects compile to `out/.htaccess` + `out/_redirects` at build time.

---

## 3. Defects found and fixed during this phase

| Defect | Impact | Fix |
| --- | --- | --- |
| `/how-it-works` was in `RESERVED_ROUTES` although no such route exists | The page was linked from the home page, primary nav and footer but never generated → guaranteed 404 | Removed from the reserved set; page now exports and appears in the sitemap |
| `sanitizeUrl` accepted protocol-relative URLs (`//host`) | A CMS field could smuggle an external origin into an `<img>`/`<a>` | Rejected explicitly, with a regression test |
| JSON-LD escaping was only testable through a component | Escaping could regress unnoticed | Extracted `serializeJsonLd`, now unit-tested (valid JSON after escaping) |
| Admin update on a composite-key table would have matched every version | Editing one scoring version could rewrite history | Added `identityKeys`; updates/deletes filter on the full key |
| `sitemap.xml` could ship empty with no explanation | Silent SEO failure | Build-time warning when `NEXT_PUBLIC_APP_URL` is unset |

---

## 4. Deliberate limitations

- **Static hosting means rebuild-to-publish.** Documented in `docs/admin-guide.md`; the admin
  UI says so on the affected screens.
- **Generation runs in the browser** on the main thread. Large target counts (10k+) will block
  the UI; a worker-based pipeline is deferred, and the UI reports progress instead of pretending
  to stream.
- **No live availability in this sandbox.** The engine is exercised with injected `fetch`
  fixtures that encode the real RDAP contract; production behaviour depends on the deployed
  endpoint and is labelled per result.
- **Anonymous favourites** use local storage only; account-backed collections require the
  configured auth provider. Neither is presented as sync-enabled until it is.
- **No image/media admin UI** despite the `media` table existing.
- `npm audit` reports **2 advisories** (moderate `next` 15.5.x, high transitive `postcss`)
  that are not resolvable without a major Next.js upgrade; recorded, not hidden.

---

## 5. Open blockers for the next gate

| Blocker | What it unblocks | Owner action |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` + anon key | Real admin reads/writes, seeded content, auth | Create project, run `supabase db push --include-seed` |
| Edge Function secrets (RDAP proxy, optional AI) | Deployed availability + AI studio | Deploy functions, set secrets |
| Email/SMTP for auth | Password resets, confirmations | Configure in Supabase dashboard |
| Real browser | E2E and Lighthouse evidence | Run `npx playwright install` on a machine with egress |

None of these block the artifact: `out/` is complete and deployable today. It runs the offline
content pack and says so, rather than pretending a database exists.

---

## 6. Next phase

1. Deploy `out/` to a staging host and verify `.htaccess` behaviour (canonical host, 301s,
   404 handler) with real HTTP requests.
2. Seeded-Supabase dry run: apply migrations + seed, grant an admin, exercise every CRUD module
   against a live database and record the results honestly.
3. Playwright E2E for the four critical journeys: generate → filter → export; availability
   statuses; admin login → edit → audit entry; redirect compilation.
4. Then continue with the remaining spec phases (monetization surfaces, AI content studio,
   advanced SEO diagnostics) with optional services still off by default.
