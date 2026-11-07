# Safe Home Network — safehomenetwork.com

A production-quality, static-first marketing and service-discovery website for
**Safe Home Network**, a US home services connection and referral platform.

Built with **React 18 + TypeScript + Vite + Tailwind CSS + React Router + Lucide**.
No database, no backend required — all business data lives in typed configuration
files so the owner can update it without touching UI components.

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

---

## Routes

| Route | Page |
| --- | --- |
| `/` | Homepage (hero, ZIP checker, trust, 12 popular services, 3-step process, benefits, FAQ, CTA) |
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
| `/service-area` | Coverage model, ZIP checker, per-service coverage table |
| `/privacy-policy` | Privacy policy |
| `/terms-and-conditions` | Terms & conditions |
| `/disclaimer` | Referral-model disclaimer |
| `/do-not-sell-or-share` | Privacy choices / opt-out request page |
| `/accessibility` | Accessibility statement |
| `*` | 404 page (noindex) |

Every page is a real page with unique content, metadata and breadcrumbs. No dead
links, no placeholder buttons.

---

## Where to edit things

Everything an owner needs to change lives in `src/config/`:

| File | Controls |
| --- | --- |
| `src/config/site.ts` | Brand name, legal entity, domain, contact email/phone/address/hours, social links, SEO defaults, launch notices |
| `src/config/services.ts` | All 15 service categories: name, icon, image, copy, common needs, options, FAQs, related services, meta title/description |
| `src/config/coverage.ts` | ZIP code coverage dataset (per service) |
| `src/config/providers.ts` | Provider records: name, services, phone, coverage, availability, disclosure |
| `src/config/faqs.ts` | Homepage and How It Works FAQ sets |
| `src/config/integrations.ts` | Contact endpoint, spam protection, call tracking, analytics (env-driven) |
| `src/data/serviceNumbers.ts` | **All service phone numbers** (10 groups, 20 numbers), statuses and campaign permissions |
| `src/data/serviceNumberMapping.ts` | Which phone group serves which website service, plus the finder categories |

Navigation, routes, the services dropdown, the directory search, related-service
lists, the sitemap and structured data are all derived from these files. Adding a
service to `services.ts` adds its page, card, menu entry and sitemap URL.

---

## ZIP code availability system

Flow: **choose service → submit 5-digit ZIP → validate → look up coverage → result**

- Validation lives in `src/lib/zip.ts` (digits only, real US ZIP range check).
- Lookup lives in `src/lib/coverage.ts`; it is deliberately conservative:
  - no record, or `verified: false` → **"coverage not verified"** (never a guess)
  - verified record + matching ZIP → **available**
  - verified record + non-matching ZIP → **not currently listed**
- UI lives in `src/components/availability/` — one modal (`AvailabilityModal`),
  one inline form (`ZipCheckForm`) and one provider block (`ProviderContact`)
  shared by the homepage, service pages, service area page and header CTA.

### ⚠️ The shipped dataset is example data

`src/config/coverage.ts` ships with representative metro ZIP prefixes so the flow
can be reviewed end to end. It is labelled in the UI as example data and is **not**
a claim that providers operate there. Before launch:

1. Replace the records with your contracted coverage.
2. Mark a record `verified: true` only when it is confirmed.
3. Set `EXAMPLE_COVERAGE_DATA = false`.

Optional per-service ZIP exclusions are supported via `COVERAGE_EXCLUSIONS`.

---

## Service phone directory

Every call button on the site reads from `src/data/serviceNumbers.ts` —
see **[docs/PHONE-DIRECTORY.md](docs/PHONE-DIRECTORY.md)** for the operations guide.

- 10 service groups × 2 numbers = **20 numbers**, all currently
  `pending-verification`, so **none are published**. Visitors see a contact
  message instead.
- A number is published only when `status: 'active'` **and** its campaign
  permissions allow the visitor's location (`nationwide`, or a `states` /
  `zipCodes` allow-list).
- Primary/alternate ordering comes from `priority`; each renders its own
  `tel:+1…` link. Calls are never auto-dialled, redirected or forwarded.
- The homepage and `/service-area` include a ZIP-first finder: it confirms the
  **city and state** through the Zippopotam.us ZIP API, then shows the call
  options authorized for that location.
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
are implemented. Submission is only attempted when `VITE_CONTACT_ENDPOINT` is set.

With no endpoint configured, the form validates normally and then states plainly
that delivery is **not** configured — it never fakes a success message. Point
`VITE_CONTACT_ENDPOINT` at Formspree, Netlify Forms, your API route, or an email
service, then rebuild.

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

---

## Quality checks performed

- `npx tsc -b` — clean, zero errors under `strict` + `noUnusedLocals`.
- `npm run build` — production build succeeds.
- `npm run smoke` — SSR render test across all 26 routes plus 404 cases.
- `npm run audit` — link, in-page anchor, image-source, duplicate-id and
  single-`h1` audit across every route (26 routes, all passing).
- `npm run test` — 33 assertions over the phone directory, service→number
  mapping, publication rules, campaign eligibility, ZIP validation and the ZIP
  API (success, cache, 404, 5xx, network, abort).
- All internal links resolve to real routes; all CTA buttons are wired to a
  working action (dialog, navigation or form).
- Availability states tested: available (e.g. `30301` for roofing), unavailable
  (e.g. `10001` for roofing), unverified (any ZIP for locksmith / concrete-paving
  / bedroom-remodeling).
- Contact form validation tested for empty, malformed email, short message and
  missing consent.
- Theme toggle tested in header and mobile drawer; preference persists.
- Tested at 320 / 375 / 430 / 768 / 1024 / 1440 / 1920 px widths.

---

## Remaining launch requirements

Owner decisions / tasks before going live:

1. **Legal entity name and registered details** — update `SITE.legalName`,
   and add `SITE.contact.addressLines` if you have a public business address.
2. **Authorized phone number** (and call-tracking number if used) —
   `SITE.contact.phone` / `phoneDisplay`; add provider records with authorized
   numbers in `src/config/providers.ts`.
3. **Real coverage data** — replace the example dataset and set
   `EXAMPLE_COVERAGE_DATA = false`.
4. **Contact form endpoint** — set `VITE_CONTACT_ENDPOINT` (+ spam key).
5. **Legal review** — Privacy Policy, Terms, Disclaimer, Do-Not-Sell and
   Accessibility pages must be reviewed by counsel for your entity, the states you
   operate in, and any advertising or call-tracking you enable. Then set
   `SITE.showLaunchNotices = false` to remove the setup notices.
6. **Imagery licensing** — all 15 categories and the hero currently use
   generated placeholder photography. Replace it with your licensed images
   before launch (keep the same filenames in `public/images/`, or update the
   `image` field in `services.ts`).
7. **Search Console / analytics** — verify the domain, submit the sitemap, and add
   your GA4 measurement id if desired.
