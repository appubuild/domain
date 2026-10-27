# DomainFits

Domain discovery, brandable naming and domain intelligence — built as a **statically exported**
Next.js application with Supabase (PostgreSQL) as the data, auth and serverless layer.

`npm run build` produces `out/`: plain HTML, CSS, JS and host configuration, uploadable to the
document root of ordinary shared hosting. **No Node.js runtime is required on the host.**

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional; the app builds fully without it
npm run dev                    # http://localhost:3000
```

Build and verify:

```bash
npm run typecheck              # tsc --noEmit, strict
npm test                       # 747 tests (engine, DB/RLS, availability, content, a11y, security)
npm run build                  # → out/ + .htaccess, _headers, _redirects (refuses if dev is running)
npm run test:a11y              # axe over every built page; run after a build
npm run audit:size             # first-load weight per route, against budgets
npm run verify                 # all of the above, in the order that makes them meaningful
```

## Deploy

1. `npm run build`
2. Upload the **contents** of `out/` to your document root.
3. Confirm `out/.htaccess` was uploaded (Apache) — it carries canonical-host rules, redirects,
   the security headers, the cache policy and the 404 handler. Netlify/Cloudflare Pages use
   `out/_redirects` and `out/_headers` instead.

Full instructions: [`docs/deployment.md`](docs/deployment.md).

## What is inside

| Area | Location | Notes |
| --- | --- | --- |
| Generator UI | `src/app/generator/`, `src/components/generator/` | Multi-root keywords, affix positions, 12 styles, filters, export |
| Naming engines | `src/lib/generator/`, `src/lib/engine/`, `src/lib/brain/` | Candidate strategies A–G, scoring with exposed component weights |
| Availability | `src/lib/availability/`, `supabase/functions/availability/` | RDAP-first, 8 statuses, no scraping, TTL cache; edge function proxies lookups server-side |
| Content pipeline | `src/lib/content/` | Build-time snapshot with Supabase fallback, sanitiser, SEO helpers |
| Public routes | `src/app/` | Static export; every route pre-rendered with `dynamicParams = false` |
| Admin panel | `src/app/admin/`, `src/components/admin/` | 25 modules, one declarative CRUD registry (incl. foreign-key reference fields) |
| AI studio | `src/lib/ai/`, `supabase/functions/ai-studio/` | Drafts only, admin-authenticated, off by default |
| Media library | `src/lib/media/`, `supabase/migrations/0007_media_storage.sql` | Storage uploads, alt text required, no SVG |
| SEO diagnostics | `src/lib/seo/diagnostics.ts` | Real findings from real rows; no invented score |
| Navigation | `src/lib/content/navigation.ts` | Header/footer resolved from `nav_menus`/`nav_items` at build time |
| Database | `supabase/migrations/`, `supabase/seed/` | 44 tables, RLS on all, seeded dictionaries |
| Monetization | `src/lib/affiliate/`, `src/lib/ads/`, `supabase/functions/affiliate-click/` | Validated registrar links + AdSense-only slots; both fail closed and ship off |
| Analytics | `src/lib/analytics/`, `supabase/migrations/0009_*` | First-party events only, aggregated in Postgres; says "not configured" when it cannot store |
| Build tooling | `scripts/` | Seed generator, hosting-config emitter (redirects, headers, caching), bundle audit, pre-build dev-server guard |

## Documentation

- [`docs/00-phase-0-audit.md`](docs/00-phase-0-audit.md) — architecture and constraints audit
- [`docs/admin-guide.md`](docs/admin-guide.md) — modules, roles, publish workflow, rollback
- [`docs/phase-1-3-report.md`](docs/phase-1-3-report.md) — what is verified, what is blocked, defects fixed
- [`docs/phase-4-report.md`](docs/phase-4-report.md) — availability wiring, analytics, test hardening
- [`docs/phase-5-report.md`](docs/phase-5-report.md) — affiliate routing and advertising runtime
- [`docs/phase-6-report.md`](docs/phase-6-report.md) — admin reference fields and the AI content studio
- [`docs/phase-7-report.md`](docs/phase-7-report.md) — the media library and its upload rules
- [`docs/phase-8-report.md`](docs/phase-8-report.md) — SEO diagnostics, and why there is no score
- [`docs/phase-9-report.md`](docs/phase-9-report.md) — the live Supabase project, and rendered navigation
- [`docs/phase-10-report.md`](docs/phase-10-report.md) — collections, saved searches and the admin surface
- [`docs/phase-11-report.md`](docs/phase-11-report.md) — affiliate and ad runtime, and why both ship off
- [`docs/phase-12-report.md`](docs/phase-12-report.md) — exact analytics, instrumentation coverage, a view that bypassed RLS
- [`docs/phase-13-report.md`](docs/phase-13-report.md) — security headers, measured weight, and the contrast defects axe cannot see
- [`docs/phase-14-report.md`](docs/phase-14-report.md) — production readiness: hardened public function, staged CSP, recorded rollback drill, operator TODOs
- [`docs/security.md`](docs/security.md) — auth model, RLS, secrets, sanitisation
- [`docs/deployment.md`](docs/deployment.md) — hosting, environment, SEO cutover

## Ground rules

- **No fabricated data.** Availability, analytics and search-volume-style metrics only show what
  was measured. Missing configuration renders an explicit "not configured" state.
- **The core generator works with every optional service disabled.** AI and paid APIs are
  opt-in, off by default.
- **Static-safe by construction.** No SSR, API routes, server actions or middleware in the tree.
- **RLS is the authorization boundary.** UI guards only decide which screens render.
