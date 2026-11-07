# Frontend ↔ API integration

The React site works with or without the PHP API. This document explains exactly what changes when
the API is enabled, what stays bundled, and how to verify the switch.

---

## 1. Two modes, one build

| | Static (default) | Connected |
| --- | --- | --- |
| Trigger | `VITE_API_BASE_URL` empty | `VITE_API_BASE_URL=https://…/api` |
| Content | Bundled TypeScript data | MySQL through the API, per slice |
| Contact form | Email endpoint / visitor's mail app | `POST /v1/leads` |
| Admin console | Demo account, browser storage | Real login + CSRF, API repository |
| Analytics | No network calls | First-party `POST /v1/analytics/events` |
| Failure behaviour | n/a | Falls back to bundled content, never a blank page |

```bash
# connected build
VITE_API_BASE_URL=https://safehomenetwork.com/api npm run build

# static build (identical to Phase 1)
npm run build
```

`VITE_API_BASE_URL` must **not** end with a slash and must **not** include `/v1`.
Optional: `VITE_CSRF_COOKIE` (default `shn_csrf`) if you rename the CSRF cookie in the API `.env`.

Because Vite inlines `import.meta.env` at build time, changing the API URL requires a rebuild. The
API URL is public by design.

---

## 2. Public site — what is live

`ContentBridge` (mounted once in `App.tsx`) calls `ensureApiContent()`, which requests these in
parallel with `Promise.allSettled`:

| Endpoint | Replaces |
| --- | --- |
| `/v1/services?full=1` | the 15-service catalogue, categories, detail pages, phone-group mapping |
| `/v1/phone-groups` | group names/labels/blurbs and active-number counts |
| `/v1/settings` | site name, contact details, socials, hours, timezone, currency |
| `/v1/faqs` | homepage FAQ list and How It Works FAQ list |
| `/v1/integrations` | GA4/GTM id, Google verification tag, header/footer snippets, maintenance flag |
| `/v1/seo` | default title/description, robots, canonical base, OG image |

Hydration is in place, not a re-render: `hydrateServices()`, `hydrateServicePhoneNumbers()`,
`hydrateServiceNumberMap()`, `hydrateCallDirectory()`, `hydrateSite()`, `hydrateFaqs()` mutate the
existing exported arrays and maps. Components keep importing the same objects, so only the first
paint happens before the data arrives (and it is the bundled content, not a skeleton).

`ContentState.source` moves `bundled → loading → api` (or `fallback` per failed slice). The shared
promise is only created once per page load; refreshes reuse it.

### Numbers and honesty

* The API returns a phone group only when it has at least one **active** number, and only for
  services actually mapped to that group.
* Six services (water damage, pest control, locksmith, bedroom remodeling, door installation,
  concrete paving) intentionally have no group: they show the contact message and never another
  trade's number.
* The same rule is enforced server-side, so a stale client cannot display an unpublished number.

### Analytics

`AnalyticsBeacon` sends page views on route change and delegates clicks on `tel:` links and
`/services/:slug` links. Admin routes are excluded. The payload contains only:

* `page_view` — path, referrer, visitor/session ids, device type, UTM fields;
* `service_click` — service id + path;
* `call_click` — service id + phone-number id + path.

Nothing is sent when `navigator.doNotTrack` is `1`/`yes`, and failures are swallowed. There is no
third-party script unless an ID is configured in Integrations.

Clicks are **not** calls. Connected calls appear only when a network report is imported into
`call_records`, and revenue only when someone records it. The dashboard shows zeros until then — by
design.

### Snippets and verification

`isSafeSnippet()` in `runtimeConfig.ts` applies the same tag allow-list as the API: only `script`,
`meta`, `link`, `style`, `noscript` are injected. Google's verification meta tag is written with
`document.head.appendChild` (never `innerHTML`). The server validates snippets again on write and on
read.

---

## 3. What stays bundled

| Area | Reason |
| --- | --- |
| Legal pages (privacy, terms, disclaimer, Do Not Sell, accessibility) | Reviewed copy; edits go through the repository, not the CMS |
| Homepage layout and Section components | Sections are presentational; the API can store ordering, but the site does not reorder them yet |
| Blog and generic CMS pages | `/v1/blog` and `/v1/pages` are implemented for future use; the current site has no blog route |
| `sitemap.xml` | Generated at build time by `scripts/generate-sitemap.mjs`; `/v1/sitemap` is available if you switch to a dynamic sitemap |
| Images under `/images` | Bundled; media uploads are served from `/api/uploads` |

If a slice fails (timeout, 500, CORS), that slice keeps its bundled value and the rest of the API
content still applies. A missing API never blocks the page.

---

## 4. Admin console

`ADMIN_CONFIG.api.enabled` follows `API_ENABLED`. When connected:

* **Authentication** — `/v1/auth/login` sets the HttpOnly session cookie; the console stores no
  token. `GET /v1/auth/session` restores the session on load. Logout calls `/v1/auth/logout`.
  The demo-credentials panel on the login page disappears, and changing the password goes through
  `/v1/auth/password`.
* **Data** — `repository` is `createApiRepository()`, mapping API records to the same
  `AdminRepository` interface the demo used. Every screen (services, numbers, pages, blog, FAQs,
  homepage, settings, SEO, media, leads, calls, revenue, team) reads and writes the database.
* **Analytics** — `useLiveAnalytics()` loads overview/timeseries/sources/landing pages/services/
  numbers/devices for the last 90 days. When data is live the “simulated data” badges disappear.
  Keywords and caller states stay empty because no Search Console or call-location source is
  connected; they are not estimated.
* **CSRF** — `apiClient` reads `VITE_CSRF_COOKIE` and sends `X-CSRF-Token` on every non-GET request.
* **Roles** — the API enforces owner/admin/editor/viewer. The UI still renders the full navigation;
  a viewer's writes fail with `403` and surface as a toast.

Demo mode remains available for UI review with no backend, and is labelled as such.

---

## 5. Deploying the switch

1. Install and verify the API (see `api/docs/INSTALLATION.md`), including `/v1/health`.
2. Add the site origins to `CORS_ALLOWED_ORIGINS`. Same-origin hosting
   (`https://site.com` + `https://site.com/api`) avoids third-party-cookie issues and is
   recommended.
3. Rebuild with `VITE_API_BASE_URL` and upload `dist/`.
4. Sign in at `/admin`, change the seeded password, review Settings and Integrations.
5. Purge any CDN cache for the pages listed in `api/docs/API-REFERENCE.md` §5.
6. Confirm on the live site: a service page shows its numbers, the contact form returns a reference,
   and Admin → Analytics shows the page view you just generated.

Rolling back is a rebuild without `VITE_API_BASE_URL`; the database is untouched.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Site still shows old copy after a CMS edit | CDN/browser cache or `PUBLIC_CACHE_TTL` | Purge cache; hard refresh |
| Admin signs in but every save fails `403` | CSRF cookie missing/blocked | Same-origin deployment; check `VITE_CSRF_COOKIE` and `COOKIE_DOMAIN` |
| Admin bounces back to login | Third-party cookies blocked | Serve frontend + API on one origin |
| Contact form always errors | API rejects the honeypot/timing (2 s) or validation | Check the response message; the form requires 20+ characters |
| Numbers missing on a service page | Group has no active numbers, or the service is intentionally unmapped | Admin → Phone numbers → set `active` |
| Analytics shows zeros | No events yet, or DNT is on | Visit a page with DNT off; check the network tab |
| "Live analytics could not be loaded" banner | API error while fetching the dashboard | Check `/v1/admin/analytics/*` credentials and CORS |
| Images 404 after upload | `UPLOAD_URL` mismatch | Set `UPLOAD_URL=/api/uploads` |

For server-side issues see `api/docs/INSTALLATION.md` §11.
