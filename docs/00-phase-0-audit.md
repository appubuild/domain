# Phase 0 — Repository Audit, Architecture Proposal & Implementation Plan

**Project:** DomainFits — Domain Discovery, Brandable Naming & Domain Intelligence Platform
**Date:** 2026-10-26
**Branch:** `arena/b181432b-domain`
**Base commit:** `46e1cb5` ("Initial commit")
**Status:** Audit complete — awaiting architecture approval (Phase 0 gate)

---

## 1. Repository audit

### 1.1 What exists

| Area | Finding |
| --- | --- |
| Tracked files | Exactly **one**: `README.md` (9 bytes, content: `# domain`) |
| Commit history | Single commit, no prior work |
| Framework | None |
| Package manager | None — no `package.json`, no lockfile |
| Frontend | None |
| Backend / API | None |
| Database | None — no schema, no migrations, no ORM, no client |
| Authentication | None |
| Environment config | None — no `.env`, `.env.example`, or equivalent |
| Tests / CI | None |
| Deployment config | None — no Dockerfile, no hosting manifest, no CI workflow |
| Dependencies | None |
| Technical debt | None (nothing to inherit) |

### 1.2 Sandbox / toolchain probe (measured, not assumed)

| Capability | Result |
| --- | --- |
| Node.js | **v22.22.3** |
| npm | **10.9.8** |
| TypeScript | available from registry (5.9.x pinned) |
| `better-sqlite3` (native) | Installs in <1s from prebuilt binaries; smoke test passed |
| `node:sqlite` (built-in) | Works but emits an ExperimentalWarning — not chosen |
| PHP | **Not installed** in this sandbox |
| `sqlite3` CLI | Not installed (Node driver is used instead) |
| Python | 3.11.2 (not required by the proposed architecture) |
| Outbound HTTPS allowlist | `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` **only** |
| `https://rdap.org/…` | **Blocked** (`SSL_ERROR_SYSCALL` / connection failure — egress filtered) |
| `https://rdap.verisign.com/…` | **Blocked** (same) |
| `https://api.github.com` | Reachable (200) |

**Direct consequence for Phase 4:** real registry RDAP responses cannot be fetched from this sandbox. The availability engine will be built with a real RDAP adapter (bootstrap + per-registry endpoints, HTTP status/`rate limit`/timeout normalization, caching) and verified against a **local fake RDAP server** in tests. Live-provider verification will be reported as **blocked — sandbox egress restriction**, never as "passed". Anyone running the app on a host with normal egress gets real results; the UI keeps a truthful `unknown` / `check_failed` state meanwhile.

### 1.3 Verdict

The repository is **empty**. There is no working functionality to preserve, no legacy schema, and no dependency conflicts. This is a greenfield build, so the safest path is: define the architecture explicitly, keep the naming engine framework-independent, and grow the app in gated phases.

---

## 2. Proposed architecture

### 2.1 Stack decision

| Layer | Choice | Why |
| --- | --- | --- |
| App framework | **Next.js 15.5 (App Router) + React 19 + TypeScript 5.9 (strict)** | One deployable unit; server-rendered public pages for real SEO; route handlers as the API; standalone output for Node hosts |
| Styling | **Tailwind CSS v4 + centralized CSS custom-property design tokens** | Design-system velocity with no hardcoded colors; `prefers-color-scheme` + class-based dark mode |
| Validation | **Zod 4** | One schema per boundary (forms, API, admin CRUD, env) |
| Persistence | **SQLite (better-sqlite3) behind a repository interface**, SQL migration runner, seeded content | Zero external service to provision; relational, transactional, indexes, FTS-free simple LIKE search; file-backed and backup-friendly |
| Auth | **Custom session-cookie auth**: `scrypt` password hashing (node:crypto), DB-backed sessions, httpOnly/SameSite/Secure cookies, RBAC, login rate limiting, CSRF double-submit on admin mutations | No paid identity provider; server-side authorization on every admin route; no frontend-only guards |
| Availability | **RDAP adapter + provider registry + cache table**; mock provider strictly non-production | Free, documented, permitted method; no scraping, no CAPTCHA bypass |
| AI (optional) | **Provider adapter** (OpenAI-compatible / Anthropic / disabled) with structured-output validation, timeouts, quotas, deterministic fallback | Core generator never depends on credentials |
| Ads | **Config-driven AdSense slots** (publisher/unit IDs in DB, never hardcoded) | Policy-safe, no arbitrary JS injection |
| Tests | **Vitest** (unit + integration on engine, repos, API handlers) + HTTP-level E2E script against a running server | No browser binaries downloadable in this sandbox → browser E2E reported as *not run* |

**Deliberately not introduced** (per the rules): Python service, Redis, message broker, separate microservice, ORM with hidden N+1, paid SaaS dependency.

### 2.2 Module boundaries

```
src/
  lib/
    brain/            # PURE TypeScript naming engine — no React, no Next, no DB
      normalize.ts        # keyword normalization, IDN/punycode, label validation
      dictionaries/       # roots, prefixes, suffixes, curated words, syllables, banlist
      semantics.ts        # synonyms, related terms, industry taxonomy + scoring
      industries.ts       # industry dictionary & rule lookup
      generate/           # strategies: direct, semantic, phrase, portmanteau, invented, ai
      score.ts            # quality + brandability scoring (versioned weights)
      pipeline.ts         # orchestrator: constraints → candidates → dedupe → rank
      types.ts            # public engine contract (the stable API surface)
    availability/     # provider interface + rdap, mock(test-only), cache, normalizer
    db/               # connection, migration runner, migrations/*.sql, repositories/*
    cms/              # pages, sections, rich-text sanitizer, media metadata
    blog/             # posts, categories, tags, related posts
    seo/              # metadata templates, sitemap, robots, structured data
    ads/              # placement resolution + AdSense rendering rules
    affiliate/        # URL template validation, allowlisted hosts, click events
    analytics/        # event collection + aggregation (real events only)
    auth/             # passwords, sessions, RBAC, CSRF, rate limiting
    ai/               # provider adapters + prompt/response validation
    config/           # validated env, site settings loader, feature flags
  app/
    (public)/         # home, generator, industries, blog, pages, legal
    admin/            # admin shell + modules (server-authorized on every route)
    api/              # versioned internal API (v1) + admin API
  components/         # design system + feature components (client/server split)
tests/                # unit, integration, e2e-http
docs/                 # audit, architecture, engine, admin, SEO, ads, deploy, limitations
```

The naming engine takes plain objects in and returns plain objects out — reusable by the HTTP API, the AI studio, and future clients.

### 2.3 Data model (initial, ~30 tables, migrations 0001+)

`users`, `roles`/`permissions` (RBAC), `sessions`, `audit_logs`, `site_settings` (versioned), `config_versions`,
`dictionary_terms`, `dictionary_relations`, `prefixes`, `suffixes`, `phrase_templates`, `industries`, `industry_terms`,
`scoring_profiles`, `brandable_profiles`, `tlds`, `availability_providers`, `availability_checks`, `availability_jobs`,
`favorites`, `collections`, `collection_items`, `saved_searches`, `pages`, `page_sections`, `posts`, `post_categories`,
`post_tags`, `post_tags_map`, `media`, `nav_menus`, `nav_items`, `seo_templates`, `redirects`, `ad_slots`, `ad_settings`,
`affiliate_providers`, `affiliate_rules`, `click_events`, `analytics_events`, `api_keys`, `jobs`.

All schema changes go through numbered SQL migrations; seeds are dev-only except the baseline content pack.

---

## 3. Feature inventory → phase map

| # | Feature area | Phase | Notes |
| --- | --- | --- | --- |
| 1 | Repository audit, architecture, risk register | **0** | This document |
| 2 | Design system, tokens, layout, theme, header/footer, error handling, tooling | **1** | Gate after foundation |
| 3 | Generator: inputs, constraints, deterministic generation, filters, sort, copy, TXT/CSV/JSON export, responsive results, TLD selection | **2** | Curated local dictionaries, labeled as such |
| 4 | Domain Brain: semantics, industries, templates, portmanteau, phonetic/invented, brandable mode, quality scoring + explanations, playground, evaluation dataset | **3** | Deterministic-first |
| 5 | Availability: provider abstraction, RDAP, status model, cache, bounded bulk jobs, retry/rate-limit, recheck | **4** | Live check **blocked by sandbox egress**; adapter tested against local fake registry |
| 6 | Favorites, collections, notes, saved searches, anonymous→account migration | **5** | |
| 7 | Admin auth, RBAC, sidebar, dashboard, audit logs, system health | **6** | |
| 8 | Naming-engine administration (dictionaries, prefixes/suffixes, industries, rules, scoring profiles, versioning, import/export) | **7** | Proof: admin edit changes new generations |
| 9 | CMS: pages, sections/page builder, rich text, nav, media, preview/publish | **8** | |
| 10 | Blog + AI content studio | **9** | AI optional; manual flow always works |
| 11 | SEO: templates, canonicals, sitemaps, robots, redirects, industry landing pages, structured data, diagnostics | **10** | |
| 12 | Affiliate routing + AdSense/ad management + diagnostics | **11** | Live ad delivery = external, reported separately |
| 13 | Analytics + advanced intelligence + evaluation | **12** | Only real collected events |
| 14 | Security/perf/a11y hardening | **13** | |
| 15 | Deployment profiles + production readiness | **14** | |
| 16 | Final acceptance, regression suite, handover | **15** | |

---

## 4. Deployment compatibility matrix

| Capability | Profile A — Local/Node (primary) | Profile B — Shared hosting | Profile C — Cloudflare |
| --- | --- | --- | --- |
| Runtime | Node 20–22, Next standalone | No persistent Node process assumed | Workers/Pages |
| Persistence | SQLite file | Needs MySQL/MariaDB via PHP backend | D1 (SQLite dialect) |
| Server rendering | Yes | Static frontend + PHP APIs | Next on Cloudflare adapter |
| Background jobs | Bounded in-process jobs + cron script | Cron + queued rows | Queues/Scheduled handlers |
| Auth sessions | DB-backed cookies | Same via PHP or external | Cookies + D1 |
| Status in this build | **Implemented & verifiable now** | **Documented migration path only — not implemented, not verified (no PHP in sandbox)** | **Adapter interface + documented port; not deployed or verified** |

Honest position: a single artifact cannot be claimed to run on all three. The engine and repository interfaces are portable; Profile A is what gets built and tested here. Profiles B and C get written migration guides and explicit "unverified" labels in Phase 14.

---

## 5. Phase checklist (gates)

- [x] Phase 0 — Audit & architecture (this doc)
- [x] Phase 1 — Foundation & design system
- [x] Phase 2 — Core generator
- [x] Phase 3 — Domain brain & scoring
- [x] Phase 4 — Availability & TLD intelligence
- [x] Phase 5 — Favorites & user features
- [x] Phase 6 — Admin auth & dashboard
- [x] Phase 7 — Naming engine administration
- [x] Phase 8 — CMS & page builder
- [x] Phase 9 — Blog & AI studio
- [x] Phase 10 — SEO & industry pages
- [x] Phase 11 — Affiliate & monetization
- [x] Phase 12 — Analytics & intelligence
- [ ] Phase 13 — Security, performance, accessibility
- [ ] Phase 14 — Deployment & production readiness
- [ ] Phase 15 — Final acceptance & handover

> The names above are the outline written in phase 0. Work was grouped slightly differently as it
> was built, so the delivered scope for each gate is what `docs/phase-*-report.md` records — e.g.
> SEO diagnostics landed with phase 8 and collections with phase 10. The ticks mean *delivered and
> verified*, not *matched this outline verbatim*.

---

## 6. Risk register

| ID | Risk | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| R1 | Sandbox blocks all registry/RDAP egress | Live availability cannot be verified here | Real adapter + local fake-registry integration tests; truthful `unknown`/`check_failed` states; document as blocked | Open (environmental) |
| R2 | No AdSense account / publisher ID | Live ad delivery unverifiable | Config-driven slots, test mode, honest "not configured" UI | Open (external credential) |
| R3 | No AI provider key | AI strategies unusable here | Adapter + deterministic fallback; core works without it | Open (external credential) |
| R4 | No browser binaries available | No real browser E2E / Lighthouse | HTTP-level E2E + unit/integration coverage; document browser E2E as not run | Open (environmental) |
| R5 | SQLite ≠ D1/MySQL | Portability claims could be overstated | Repository interfaces, portable SQL, documented port | Monitored |
| R6 | Scoring heuristics could read as scientific | Trust/claims risk | Label as heuristic, expose component scores, version weights | Mitigated by design |
| R7 | Scope size vs. single session | Partial delivery | Strict phase gates, real completion reports | Monitored |
| R8 | Trademark screening could be misread as legal clearance | Legal risk | Label as non-legal signal, never implied clearance | Mitigated by design |
| R9 | Large-generation abuse | Cost/DoS | Server-side caps, rate limits, request-size limits, bounded loops | Monitored |
| R10 | Secrets leaking into client bundle | Security | Zod-validated server-only env, `NEXT_PUBLIC_` audited, no keys in DB reads for public routes | Monitored |

---

## 7. Immediate dependencies

**Needed now (Phase 1–2):** none external. No credentials.

**Needed later, optional:** AI provider key (Phase 9), AdSense publisher/unit IDs (Phase 11), registrar affiliate templates (Phase 11). **Blocked regardless of keys:** live RDAP from this sandbox (R1).

**Not needed at all:** paid DB, Redis, message broker, email provider (unless email features are later enabled).

---

## 8. Decisions requested

1. **Approve the stack** (Next.js 15 + TypeScript + Tailwind v4 + SQLite) — or specify an alternative.
2. **Deployment scope**: build and verify Profile A here, with Profiles B/C documented as migration paths (recommended), or block on a PHP/MySQL shared-hosting backend.
3. **Pacing**: proceed phase-by-phase with a completion report at each gate and continue automatically, or pause for explicit approval after every gate.

Nothing will be built until these are confirmed.
