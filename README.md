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
npm test                       # 132 tests (engine, DB/RLS, availability, content)
npm run build                  # → out/  + compiled redirects (refuses if dev is running)
```

## Deploy

1. `npm run build`
2. Upload the **contents** of `out/` to your document root.
3. Confirm `out/.htaccess` was uploaded (Apache) — it carries canonical-host rules, redirects
   and the 404 handler. Netlify/Cloudflare Pages can use `out/_redirects` instead.

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
| Database | `supabase/migrations/`, `supabase/seed/` | 44 tables, RLS on all, seeded dictionaries |
| Monetization | `src/lib/affiliate/`, `src/lib/ads/`, `supabase/functions/affiliate-click/` | Validated registrar links + AdSense-only slots; both fail closed and ship off |
| Analytics | `src/lib/analytics/` | First-party events only; says "not configured" when it cannot store |
| Build tooling | `scripts/` | Seed generator, redirect emitter, pre-build dev-server guard |

## Documentation

- [`docs/00-phase-0-audit.md`](docs/00-phase-0-audit.md) — architecture and constraints audit
- [`docs/admin-guide.md`](docs/admin-guide.md) — modules, roles, publish workflow, rollback
- [`docs/phase-1-3-report.md`](docs/phase-1-3-report.md) — what is verified, what is blocked, defects fixed
- [`docs/phase-4-report.md`](docs/phase-4-report.md) — availability wiring, analytics, test hardening
- [`docs/phase-5-report.md`](docs/phase-5-report.md) — affiliate routing and advertising runtime
- [`docs/phase-6-report.md`](docs/phase-6-report.md) — admin reference fields and the AI content studio
- [`docs/security.md`](docs/security.md) — auth model, RLS, secrets, sanitisation
- [`docs/deployment.md`](docs/deployment.md) — hosting, environment, SEO cutover

## Ground rules

- **No fabricated data.** Availability, analytics and search-volume-style metrics only show what
  was measured. Missing configuration renders an explicit "not configured" state.
- **The core generator works with every optional service disabled.** AI and paid APIs are
  opt-in, off by default.
- **Static-safe by construction.** No SSR, API routes, server actions or middleware in the tree.
- **RLS is the authorization boundary.** UI guards only decide which screens render.
