# Admin Console

A production-styled admin panel at **`/admin`** for the Safe Home Network site.

The console runs in one of two modes, selected at build time by
`VITE_API_BASE_URL`:

| | Connected | Demo |
| --- | --- | --- |
| Trigger | `VITE_API_BASE_URL` set | variable empty |
| Auth | `POST /v1/auth/login`, HttpOnly cookie + CSRF | bundled credentials, `localStorage` |
| Data | MySQL through `data/apiRepository.ts` | `localStorage` seed |
| Analytics | recorded events from the API | deterministic simulation, labelled |
| Warning banner | none | “Demo mode” / “Simulated data” everywhere |

Set `VITE_API_BASE_URL=https://your-domain.com/api` and rebuild to run connected.
The screens, routes and data contracts are identical in both modes.

---

## 1. Demo credentials

| Field | Value |
| --- | --- |
| URL | `/admin` (redirects to `/admin/login` when signed out) |
| Email | `info@safehomenetwork.com` |
| Password | `Sa123456` |

Both live in **`src/admin/config/adminConfig.ts`** (`ADMIN_CONFIG.demo`). Change
them there — the login screen reads the same object, so its placeholders always
match.

### What the demo authentication does and does not do

| Does | Does not |
| --- | --- |
| Protects every admin route; unauthenticated visitors are redirected to the login screen | Validate anything on a server |
| Stores a session with an **8-hour expiry** and auto-signs-out when it lapses | Hash the password |
| Clears the session on logout and on “Extend session” expiry | Survive a cleared browser |
| Shows a permanent demo-mode warning on the login screen and profile page | Prevent anyone reading the credentials in the bundle |

**Demo mode is not production security.** Anyone can read the JavaScript bundle.
Use it only to review the UI. In connected mode the demo panel is not rendered at
all and credentials never reach the browser — see §5.

Do not advertise `/admin` publicly in either mode; `robots.txt` disallows it and
the console injects `noindex,nofollow`.

---

## 2. Routes

| Route | Screen |
| --- | --- |
| `/admin/login` | Sign-in with demo credential hints |
| `/admin` | Dashboard (KPIs, trend chart, sources, numbers, services, leads, activity) |
| `/admin/analytics` | Full reports: date filters, metric switch, keyword/landing/service tables, CSV export |
| `/admin/services` | Service categories CRUD, niche + phone-group assignment, SEO fields |
| `/admin/numbers` | Tracking numbers CRUD, priority (primary/alternate), status, network, campaign, notes |
| `/admin/niches` | Niche CRUD with service counts and pause/activate |
| `/admin/pages` | Page CRUD, publish/unpublish, SEO metadata |
| `/admin/blog` | Post CRUD, categories, featured image, SEO, schedule |
| `/admin/homepage` | Section order, visibility toggles, heading/subheading editing |
| `/admin/leads` | Lead inbox, triage status, assignment, reply composer |
| `/admin/settings` | Business details, contact routing, socials, operation switches, demo reset |
| `/admin/seo` | Global metadata, robots rules, verification IDs, SERP preview |
| `/admin/profile` | Profile, password change, session details, security model, activity log |

The panel is lazy-loaded (`React.lazy` in `src/App.tsx`), so public visitors never
download it. `robots.txt` disallows `/admin`, and the console injects a
`noindex,nofollow` meta tag while open.

---

## 3. Architecture

```
src/admin/
├── AdminApp.tsx              routes + auth guard + providers
├── config/adminConfig.ts     demo credentials, session length, API placeholders
├── types/admin.ts            all data models (mirror the future API payloads)
├── data/
│   ├── seed.ts               demo workspace; services + numbers derived from the live site
│   ├── repository.ts         AdminRepository interface + LocalStorage implementation
│   ├── apiRepository.ts      REST implementation over the PHP API
│   ├── apiClient.ts          fetch wrapper: /v1 prefix, CSRF header, cookie session
│   ├── liveAnalytics.ts      loads the analytics screens from /v1/admin/analytics/*
│   ├── analytics.ts          deterministic simulated analytics
│   └── storage.ts            localStorage adapter with in-memory fallback (SSR/tests)
├── context/
│   ├── AdminAuthContext.tsx  API or demo session, guards, password change
│   └── ToastContext.tsx      toast notifications
├── components/
│   ├── AdminLayout.tsx       sidebar + topbar + independent scroll areas
│   ├── DataTable.tsx         search, sort, pagination, empty + loading states
│   ├── charts.tsx            hand-written SVG area/line, donut, bars, sparklines
│   ├── StatCard.tsx          KPI cards + simulated-data notice
│   └── ui.tsx                button, input, select, badge, modal, confirm, toast styles
├── lib/{format,selectors}.ts formatting + derived directory views
└── pages/                    13 screens
```

**Rules the code follows**

1. No component imports `localStorage` or `fetch` — everything goes through
   `repository`.
2. No component contains seed data — `data/seed.ts` and `data/analytics.ts` own it.
3. Mutations validate in the repository (unique slugs, unique numbers, phone
   format) so the PHP API can enforce the identical rules.
4. Every repository method is `async`, so swapping in HTTP changes nothing above
   the data layer.

### Seeded services and numbers are real

`data/seed.ts` builds its services from `src/config/services.ts` and its numbers
from `src/data/serviceNumbers.ts` / `serviceNumberMapping.ts`. The demo panel
therefore starts with **the same 15 services, 10 phone groups and 20 numbers the
public site uses** — no invented phone numbers.

---

## 4. What is mock data

| Screen | Demo mode | Connected mode |
| --- | --- | --- |
| Dashboard KPIs, charts, sources, landing pages | Simulated, labelled | Recorded events (`analytics_events`, `leads`, `call_records`, `revenue_records`) |
| Analytics & reports, CSV | Simulated | Same recorded data; CSV says “recorded” |
| Keywords / caller states | Simulated | **Empty** — no Search Console or call-location source is connected |
| Services, numbers, niches, pages, blog, homepage, FAQs | Seed + local edits | Database |
| Leads & support | Fictional demo enquiries | Real submissions from the contact form |
| Settings, SEO | Pre-filled from `SITE` | Database; public site reflects them after cache purge |
| Activity log | This browser’s demo actions | `activity_log` (audit trail) |

In connected mode the “Simulated data” badge and notice disappear automatically
once a real snapshot loads. If the analytics request fails, the panel says so and
keeps the labelled demo figures rather than showing fake “live” numbers. Nothing
on the panel estimates traffic, calls or revenue.

---

## 5. Connected mode

When `VITE_API_BASE_URL` is set:

1. **`ADMIN_CONFIG.api`** — `enabled: true`, `baseUrl` from the environment,
   `/admin/*` endpoints, cookie session (no bearer token).
2. **`data/apiClient.ts`** — prefixes `/v1`, sends `credentials: 'include'`,
   adds `X-CSRF-Token` from the CSRF cookie on writes, 15-second timeout, and
   raises `ApiNotConfiguredError` when no base URL exists.
3. **`data/apiRepository.ts`** — the full `AdminRepository` interface over REST,
   including snake_case ↔ camelCase mapping, settings flattening, SEO mapping and
   string ids for the UI.
4. **`data/repository.ts`** — picks the implementation:

   ```ts
   export const repository = ADMIN_CONFIG.api.enabled
     ? createApiRepository()
     : localRepository
   ```

5. **`context/AdminAuthContext.tsx`** — `/v1/auth/login`, `/v1/auth/session`,
   `/v1/auth/logout`, `/v1/auth/profile`, `/v1/auth/password`; stores no token.
6. **`data/liveAnalytics.ts`** — `useLiveAnalytics()` fetches the 90-day snapshot
   and feeds it to `buildAnalytics()`.

Server-side implementation: `api/` (129 routes). Endpoint detail is in
`api/docs/API-REFERENCE.md`; security in `api/docs/SECURITY.md`.

### Role enforcement

The API enforces `owner` > `admin` > `editor` > `viewer` on every write. The UI
still shows the full navigation to every signed-in role, so a viewer who tries to
save receives a `403` toast (the server is the source of truth). Demo mode has no
roles and never claims to.

## 6. Resetting the demo

**Settings → Demo data → Reset demo data** restores the seeded snapshot
(services, numbers, niches, pages, posts, sections, leads, settings, SEO). It does
not touch the public site or the production phone directory.

---

## 7. Tests

```bash
npm run test:admin    # 83 assertions
npm run test          # directory 28 + admin 83 + API 33 = 144
```

The admin suite covers the demo credential configuration, protected-route
behaviour (signed out vs signed in, including the login redirect), rendering of —
every admin route, repository CRUD and validation for all six entities, seed
fidelity against the live service/number mapping, selectors, analytics maths and
formatting helpers.

The API suite (`npm run test:api`) covers the mapper/hydration layer that makes
connected mode possible. Server-side tests live in `api/tests/` and are described
in `api/docs/TESTING.md`.
