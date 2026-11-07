# Admin Console — Phase 1 (static demo)

A production-styled admin panel at **`/admin`** for the Safe Home Network site.
Phase 1 is deliberately **front-end only**: no PHP, no MySQL, no API calls. Every
write goes to `localStorage` so the workflows can be reviewed safely before the
backend exists.

> **Phase 2** (PHP + MySQL REST API) is not started. The data layer is already
> shaped for it — see [Phase 2 hand-off](#phase-2-hand-off).

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

**This is not production security.** Anyone can read the JavaScript bundle. Do
not put real business data behind this panel until Phase 2 lands, and do not
advertise `/admin` publicly.

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
│   ├── apiRepository.ts      Phase 2 REST implementation (unwired)
│   ├── apiClient.ts          Phase 2 fetch client + token handling (unwired)
│   ├── analytics.ts          deterministic simulated analytics
│   └── storage.ts            localStorage adapter with in-memory fallback (SSR/tests)
├── context/
│   ├── AdminAuthContext.tsx  demo session, guards helpers, password change
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

| Screen | Mock? | Notes |
| --- | --- | --- |
| Dashboard KPIs, charts, sources, keywords, landing pages, revenue | **Simulated** | Deterministic generator in `data/analytics.ts`; labelled “Simulated data” everywhere |
| Analytics & reports (all tables, CSV) | **Simulated** | Same module; CSV exports the simulated series |
| Services, numbers, niches | Real seed, local edits | Edits persist in this browser only |
| Pages, blog, homepage sections | **Fictional demo content** | Text is illustrative, not site copy |
| Leads & support | **Fictional demo enquiries** | Emails use `example.com` |
| Settings, SEO | Real values pre-filled from `SITE` | Saving only affects the demo workspace |
| Activity log | Real (of this browser’s demo actions) | |

What the panel does **not** claim: no real traffic, no real calls, no real
revenue, and no statement that editing here changes the live site.

---

## 5. Phase 2 hand-off

Everything below is prepared but **not connected**:

1. **`ADMIN_CONFIG.api`** — `enabled: false`, `baseUrl: ''`, endpoint paths, timeout,
   auth header and scheme.
2. **`data/apiClient.ts`** — `request<T>()` with bearer token, JSON, timeout and
   `credentials: 'include'`, plus `ApiNotConfiguredError` so nothing silently fails.
3. **`data/apiRepository.ts`** — the full `AdminRepository` interface over REST.
   Wiring it is one line in `data/repository.ts`:

   ```ts
   export const repository = ADMIN_CONFIG.api.enabled
     ? createApiRepository()
     : localRepository
   ```

4. **`types/admin.ts`** — the JSON contract for the PHP endpoints.

### Suggested PHP/MySQL work for Phase 2

- `POST /auth/login` → hashed password (`password_verify`), session cookie,
  rate limiting; `GET /auth/session`, `POST /auth/logout`.
- Tables: `admins`, `services`, `phone_groups`, `tracking_numbers`, `niches`,
  `pages`, `blog_posts`, `homepage_sections`, `leads`, `settings`, `seo_settings`,
  `activity_log`.
- Enforce in SQL/PHP what the demo repository enforces in JS: unique `slug`,
  unique `number`, `priority` ordering, `status` enum.
- `GET /analytics?range=30` → replace `data/analytics.ts`; the UI already treats
  the response as `AnalyticsSnapshot`.
- Keep `localStorage` only for UI preferences (sidebar state, last range).

---

## 6. Resetting the demo

**Settings → Demo data → Reset demo data** restores the seeded snapshot
(services, numbers, niches, pages, posts, sections, leads, settings, SEO). It does
not touch the public site or the production phone directory.

---

## 7. Tests

```bash
npm run test:admin    # 83 assertions
npm run test          # public directory suite + admin suite
```

The admin suite covers the demo credential configuration, protected-route
behaviour (signed out vs signed in, including the login redirect), rendering of —
every admin route, repository CRUD and validation for all six entities, seed
fidelity against the live service/number mapping, selectors, analytics maths and
formatting helpers.
