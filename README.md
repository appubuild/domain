# Safe Home Network — safehomenetwork.com

A production-quality, static-first marketing and service-discovery website for
**Safe Home Network**, a US home services connection and referral platform.

Built with **React 18 + TypeScript + Vite + Tailwind CSS + React Router + Lucide**.
It ships as a static site with all business data in typed configuration files, and
it can optionally read everything from the bundled **PHP 8 + MySQL API** in `api/`.
No build step is required to deploy the API — upload the folder, import one SQL
file, set the database credentials.

---

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173

npm run build     # type-check + sitemap + production build → dist/
npm run preview   # preview the production build
npm run typecheck # TypeScript only
npm run sitemap   # regenerate public/sitemap.xml
```

Node 18+ required. `npm run build` regenerates `public/sitemap.xml` automatically.

To make the site read live content from the API:

```bash
VITE_API_BASE_URL=https://safehomenetwork.com/api npm run build
```

Leave the variable empty to keep the static build. See
**[docs/API-INTEGRATION.md](docs/API-INTEGRATION.md)** for what changes and
**[api/README.md](api/README.md)** for the backend.

---

## Routes

| Route | Page |
| --- | --- |
| `/` | Homepage (hero, Call Now, service picker, trust, popular services, 3-step process, benefits, FAQ, CTA) |
| `/about` | About / business model disclosure |
| `/services` | Directory with live search + category filtering (shareable `?q=` / `?category=` state) |
| `/services/roofing` | Service template — roofing |
| `/services/roof-repair` | Service template — roof repair |
| `/services/plumbing` | Service template — plumbing |
| `/services/hvac` | Service template — HVAC |
| `/services/ac-repair` | Service template — AC repair |
| `/services/water-damage` | Service template — water damage restoration |
| `/services/pest-control` | Service template — pest control |
| `/services/kitchen-remodeling` | Service template — kitchen remodeling |
| `/services/bathroom-remodeling` | Service template — bathroom remodeling |
| `/services/bedroom-remodeling` | Service template — bedroom remodeling |
| `/services/electrical` | Service template — electrical |
| `/services/window-installation` | Service template — window installation |
| `/services/door-installation` | Service template — door installation |
| `/services/concrete-paving` | Service template — concrete & paving |
| `/services/locksmith` | Service template — locksmith |
| `/how-it-works` | Process, the three availability outcomes, next steps, FAQ |
| `/contact` | Validated contact form + configurable contact details |
| `/service-area` | How the call lines work, per-service call availability table |
| `/privacy-policy` | Privacy policy |
| `/terms-and-conditions` | Terms & conditions |
| `/disclaimer` | Referral-model disclaimer |
| `/do-not-sell-or-share` | Privacy choices / opt-out request page |
| `/accessibility` | Accessibility statement |
| `/admin` | Admin console (sign-in required, `noindex`; demo account or API login) |
| `*` | 404 page (noindex) |

Every page is a real page with unique content, metadata and breadcrumbs. No dead
links, no placeholder buttons.

---

## Where to edit things

Everything an owner needs to change lives in `src/config/`:

| File | Controls |
| --- | --- |
| `src/config/site.ts` | Brand name, legal entity, domain, contact email/phone/address/hours, social links, SEO defaults |
| `src/config/services.ts` | All 15 service categories: name, icon, image, copy, common needs, options, FAQs, related services, meta title/description |
| `src/config/faqs.ts` | Homepage and How It Works FAQ sets |
| `src/config/integrations.ts` | Contact endpoint, spam protection, call tracking, analytics (env-driven) |
| `src/data/serviceNumbers.ts` | **All service phone numbers** (10 groups, 20 numbers), statuses and campaign permissions |
| `src/data/serviceNumberMapping.ts` | Which phone group serves which website service, plus the call-sheet categories |

Navigation, routes, the services dropdown, the directory search, related-service
lists, the sitemap and structured data are all derived from these files. Adding a
service to `services.ts` adds its page, card, menu entry and sitemap URL.

---

## Call flow (no ZIP code)

Flow: **choose a service → the sheet/page shows its two lines → tap to dial.**

- There is no ZIP input, no ZIP validation and no coverage lookup anywhere in the
  app. `src/lib/zip.ts`, `src/lib/zipLookup.ts`, `src/lib/coverage.ts`,
  `src/config/coverage.ts`, `src/config/providers.ts` and
  `src/components/availability/` were removed in this release.
- Resolution lives in `src/lib/phoneDirectory.ts` (`resolveServiceCall`). It takes
  a service slug and returns the published primary + alternate numbers, or a
  contact fallback.
- UI lives in `src/components/calls/`:
  - `CallSheet` — the single dialog. Opens on a service picker and reveals the
    chosen service's numbers.
  - `CallConnectionPanel` — renders "Call Now" / "Call Alternate" tel links inline
    (service pages, homepage picker, dialog).
  - `ServiceCallDirectory` — homepage / service-area "select a service" section.
  - `CallContext` — `useCallSheet()` provider used by the header, footer and CTAs.
- Numbers appear only after a service is selected. Listing pages render buttons,
  not phone numbers; `npm run audit` fails if a `tel:` link appears on a
  non-service route.

---

## Service phone directory

Every call button on the site reads from `src/data/serviceNumbers.ts` —
see **[docs/PHONE-DIRECTORY.md](docs/PHONE-DIRECTORY.md)** for the operations guide.

- 10 service groups × 2 numbers = **20 live numbers** (owner-confirmed
  2026-11-07), published nationwide. The six services with no authorized group
  deliberately show a contact message instead of borrowing another trade's
  number.
- A number is published only when `status: 'active'` **and** its campaign is
  marked `nationwide: true`. State/ZIP-restricted campaigns are withheld on
  purpose: the site no longer collects a location, so it cannot honour them.
- Primary/alternate ordering comes from `priority`; each renders its own
  `tel:+1…` link. Calls are never auto-dialled, redirected or forwarded.
- The homepage and `/service-area` include a "select a service" section that
  reveals the chosen service's numbers inline — no location step.
- In `npm run dev` only, unpublished numbers appear with a "Not published" badge
  and a preview notice so the layout can be reviewed without publishing.

### Website business contact (not the call directory)

- `SITE.contact.phone` and `SITE.contact.phoneDisplay` are **empty on purpose**.
  The UI hides every call button and shows a "contact our team" fallback until a
  real, authorized number is added.
- `PROVIDERS` in `src/config/providers.ts` ships **empty** for the same reason:
  no provider phone number is published until the provider authorizes it.
  `PROVIDER_TEMPLATE` shows the exact record shape.
- Call buttons render as `<a href="tel:+1…">Call Now</a>` and fire a
  `call_intent` event into the tracking layer (`src/lib/tracking.ts`).
- Tracking adapters exist for CallRail / Ringba / MarketCall / GTM, but stay dark
  until configured. No call or conversion is ever simulated.

---

## Contact form

Client-side validation, inline errors, `aria-invalid`, honeypot and timing checks
are implemented. Delivery depends on which backend is configured:

1. **`VITE_API_BASE_URL` set** — the form posts to `POST /v1/leads` and shows the
   reference returned by the API. Submissions appear under Admin → Leads.
2. **`VITE_CONTACT_ENDPOINT` set (no API)** — the form posts to that endpoint
   (Formspree, Netlify Forms, …).
3. **Neither set** — the form validates normally and clearly states that delivery
   is not configured, with a button that opens the visitor's email app. It never
   fakes a success message.

---

## Design system

- **Palette:** navy `#10243A`, brand blue `#2563EB`, light blue `#EFF6FF`,
  soft gray `#F5F7FA`, warm orange `#F59E0B`, success green `#16A34A`.
- **Type:** Manrope (display) + Inter (body), loaded from Google Fonts.
- **Theming:** class-based dark mode via CSS variables (`page`, `surface`,
  `elevated`, `soft`, `ink`, `muted`, `line`), persisted in `localStorage`
  (`shn-theme`), with a no-flash inline script in `index.html` and OS-preference
  following until the visitor chooses explicitly.
- **Motion:** IntersectionObserver reveals + hover transitions, fully disabled
  under `prefers-reduced-motion`.
- **Accessibility:** skip link, landmarks, focus-visible rings, focus trapping in
  the availability dialog, keyboard-operable menus/accordion, labelled form
  fields with announced errors, alt text on all content images.

---

## SEO

- Per-route title, description, canonical, Open Graph and Twitter tags via
  `useSeo` (`src/lib/seo.ts`).
- JSON-LD: `Organization` + `WebSite` + `FAQPage` on the homepage, `BreadcrumbList`
  and `FAQPage` on service pages, `ItemList` on the directory. No fake addresses,
  ratings, reviews or LocalBusiness data.
- `public/sitemap.xml` is generated from the service config (27 URLs including the
  homepage and all categories) by `npm run sitemap` / `prebuild`.
- `public/robots.txt` points at the sitemap.
- Semantic headings (one `h1` per page), breadcrumbs on every inner page, internal
  linking between related services.

Add the site to Google Search Console and submit
`https://safehomenetwork.com/sitemap.xml` after the domain is live.

---

## Deployment (static hosting)

Build command `npm run build`, output directory `dist/`.

A step-by-step walkthrough for each host (including cPanel and WordPress-style
shared hosting) lives in **[docs/HOSTING.md](docs/HOSTING.md)**.

SPA rewrites are included for the common hosts:

- **Apache / cPanel / LiteSpeed** — `public/.htaccess` ships inside `dist/` with the rewrite, HTTPS redirect, caching, compression and security headers.
- **Netlify / Cloudflare Pages** — `netlify.toml` and `public/_redirects` (`/* → /index.html 200`).
- **Vercel** — `vercel.json` rewrite + cache/security headers.
- **Amazon S3 + CloudFront** — set the error document to `/index.html` with a 200
  response for 403/404, or use a CloudFront function that rewrites unknown paths.
- **Apache** — in the site's `.htaccess`:
  ```apache
  <IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
  </IfModule>
  ```
- **Nginx** — `try_files $uri $uri/ /index.html;`

Verify a deep link (e.g. `/services/locksmith`) after deploying, not just the homepage.

### With the PHP API

Deploy `api/` beside the built site (e.g. `public_html/api/`), import the SQL file and point
`VITE_API_BASE_URL` at `https://your-domain.com/api` before building. cPanel steps, permissions,
HTTPS/CORS and the health check are in **[api/docs/INSTALLATION.md](api/docs/INSTALLATION.md)**.
Exclude `/api/uploads` from the SPA rewrite so uploaded images are served as files.

---

## Admin console

A separate, lazy-loaded admin panel at **`/admin`** manages the directory, content
and settings. It runs in one of two modes, chosen by `VITE_API_BASE_URL`:

* **Connected** — real login (`/v1/auth/login`, HttpOnly cookie + CSRF), every
  screen reads and writes MySQL through `apiRepository.ts`, and analytics come
  from recorded events.
* **Demo** — no API configured: browser `localStorage`, simulated analytics, and
  a labelled demo account for reviewing the UI.

See **[docs/ADMIN-PANEL.md](docs/ADMIN-PANEL.md)** for screens and
**[docs/API-INTEGRATION.md](docs/API-INTEGRATION.md)** for the mode switch.

- **Login:** `info@safehomenetwork.com` / `Sa123456` — set in
  `src/admin/config/adminConfig.ts` (`ADMIN_CONFIG.demo`).
- **Screens:** dashboard, analytics & reports, services, tracking numbers, niches,
  pages, blog, homepage sections, leads, website settings, SEO settings, profile
  & security.
- **Data layer:** `src/admin/data/repository.ts` exports the interface and picks
  `createApiRepository()` (REST) or the `localStorage` implementation based on
  `ADMIN_CONFIG.api.enabled`.
- **Seed:** services and numbers come from the live `services.ts` /
  `serviceNumbers.ts` — the panel starts in sync with the public directory.
- **Not real in demo mode:** traffic, calls, revenue and leads are clearly labelled
  simulated data. In connected mode the labels disappear because the figures are
  recorded; anything without a data source (Search Console keywords, caller
  states) stays empty rather than being estimated.

## PHP API (Phase 2)

`api/` is a dependency-free PHP 8.1+ backend with one MySQL schema (22 tables) and
129 routes under `/v1`. Start with **[API.md](API.md)**.

* **Install:** import `api/database/safehomenetwork.sql` in phpMyAdmin, copy
  `api/.env.example` → `.env`, verify `/api/v1/health`. Full guide:
  **[api/docs/INSTALLATION.md](api/docs/INSTALLATION.md)**.
* **Endpoints:** services (with `?full=1`), phone groups, pages, blog, homepage,
  FAQs, settings, integrations, SEO, sitemap, leads, first-party analytics, plus
  admin CRUD for every screen, calls, revenue, media and team. Reference:
  **[api/docs/API-REFERENCE.md](api/docs/API-REFERENCE.md)**.
* **Security:** bcrypt cost 12, hashed session tokens, CSRF header, RBAC
  (owner/admin/editor/viewer), rate limits, snippet allow-list, upload
  hardening. Details: **[api/docs/SECURITY.md](api/docs/SECURITY.md)**.
* **Seed:** 15 services, 5 categories, 10 phone groups, 20 numbers, 12 pages,
  6 posts, 8 sections, 12 FAQs, 33 settings. Change the seeded password on the
  first login.
* **Tests:** `php api/tests/run-tests.php` (56 assertions),
  `php api/tests/route-check.php` (129 routes / 217 calls),
  `php api/tests/http-smoke.php GET /v1/health`. See
  **[api/docs/TESTING.md](api/docs/TESTING.md)**.

## Quality checks performed

- `npx tsc -b` — clean, zero errors under `strict` + `noUnusedLocals`.
- `npm run build` — production build succeeds.
- `npm run smoke` — SSR render test across all 26 routes plus 404 cases.
- `npm run audit` — link, in-page anchor, image-source, duplicate-id and
  single-`h1` audit across every route (26 routes, all passing).
- `npm run test` — 144 assertions: 28 over the public phone directory
  (mapping, publication rules, campaign permissions, rendered markup — numbers
  never appear before a service is selected), 83 over the admin console
  (demo credentials, protected routes, every admin screen rendering, repository
  CRUD and validation, seed fidelity, analytics maths) and 33 over the API
  integration layer (mappers, directory round-trip, hydration, snippet guard,
  client errors).
- `npm run test:admin` — the admin suite on its own.
- All internal links resolve to real routes; all CTA buttons are wired to a
  working action (dialog, navigation or form).
- Call flow tested end to end: every one of the 15 service pages either renders
  exactly two `tel:` links (its own primary + alternate) or a contact fallback,
  and the listing pages render zero `tel:` links.
- Contact form validation tested for empty, malformed email, short message and
  missing consent.
- Theme toggle tested in header and mobile drawer; preference persists.
- Tested at 320 / 375 / 430 / 768 / 1024 / 1440 / 1920 px widths.

---

## Remaining launch requirements

Owner decisions / tasks before going live:

1. **Legal entity name and registered details** — update `SITE.legalName`,
   and add `SITE.contact.addressLines` if you have a public business address.
2. **Service phone numbers** — already live in `src/data/serviceNumbers.ts`
   (20 owner-confirmed lines, two per trade). `SITE.contact.phone` /
   `phoneDisplay` are only for an optional company-wide line.
3. **Contact form delivery (optional)** — the API route is used when
   `VITE_API_BASE_URL` is set; otherwise set `VITE_CONTACT_ENDPOINT` (+ spam key)
   to deliver; without either, the form opens the visitor's email app with the
   message pre-filled and addressed to `SITE.contact.email`
   directly instead.
4. **Legal review** — Privacy Policy, Terms, Disclaimer, Do-Not-Sell and
   Accessibility pages must be reviewed by counsel for your entity, the states you
   operate in, and any advertising or call-tracking you enable. Launch notices are
   no longer rendered anywhere; the owner checklist lives in
   `docs/PRE-LAUNCH-CHECKLIST.md`.
5. **Imagery licensing** — all 15 categories and the hero currently use
   generated placeholder photography. Replace it with your licensed images
   before launch (keep the same filenames in `public/images/`, or update the
   `image` field in `services.ts`).
6. **Search Console / analytics** — verify the domain, submit the sitemap, and add
   your GA4 measurement id if desired.
