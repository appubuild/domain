# Testing

Three layers, from cheapest to most realistic. All commands assume the repository root unless
noted.

| Layer | Command | Needs MySQL | What it proves |
| --- | --- | --- | --- |
| Frontend suites | `npm run test` | no | Static site, admin demo, API mapper/hydration layer |
| API unit + static checks | `php tests/run-tests.php`, `php tests/route-check.php` (in `api/`) | no | Validation, sanitising, snippets, routing, method wiring |
| CLI request smoke | `php tests/http-smoke.php GET /v1/health` (in `api/`) | for some routes | The real router + middleware pipeline answers as expected |
| Manual DB checklist | §5 | **yes** | End-to-end behaviour on a provisioned host |

---

## 1. Frontend

```bash
npm run test        # directory 28 + admin 83 + API 33 = 144 assertions
npm run typecheck   # tsc -b --force
npm run build       # tsc -b + vite build
npm run smoke       # 26 routes render server-side
npm run audit       # broken links, anchors, images, duplicate ids
```

Expected tail:

```text
28 passed, 0 failed
83 passed, 0 failed
API integration tests: 33 passed, 0 failed
```

`npm run test` builds each suite with Vite's SSR pipeline, so it also catches import cycles and
node/browser boundary mistakes.

What the API suite (`scripts/test-api.tsx`) covers:

* no `VITE_API_BASE_URL` in the test build → the site stays on bundled content;
* `ApiError` fields and `api_not_configured` rejection;
* `mapService` / `mapCategory` / `mapDirectory` / `mapSettingsToSitePatch`;
* the 10-group / 20-number directory round-trip (including services with no group);
* snippet allow-list (`isSafeSnippet`);
* `hydrateServices`, `hydrateServicePhoneNumbers`, `hydrateServiceNumberMap`, `hydrateSite`,
  `hydrateFaqs`.

What it cannot cover: real HTTP, cookies, CSRF and database reads. Those need a PHP host (§5).

---

## 2. API unit tests

```bash
cd api
php tests/run-tests.php
```

Expected: `56 passed, 0 failed`.

The suite is dependency-free (no Composer, no PHPUnit) and runs in-process. It covers:

* route table shape (unique method+path pairs, `/v1` prefix, expected route count);
* `Request` path normalisation and query parsing;
* `Validator` rules: required, min/max, email, `in:`, bool, dates, nested field errors;
* `Security`: token hashing, constant-time compare, bcrypt cost, `isSafeUrl`,
  `sanitizeHtml` (script/iframe/event-handler stripping, `javascript:` hrefs, target rel),
  `validateSnippet` (hosts, inline APIs, disallowed tags, slot rules), measurement ids;
* `HoneypotService` (trap field, too-fast submission, future timestamp);
* phone-number normalisation and duplicate handling in `PhoneNumberModel`;
* JSON envelope helpers.

### No PHP installed?

Any PHP 8.1+ CLI works. In a sandbox without PHP you can use the WASM build:

```bash
cd api
npx -y @php-wasm/cli tests/run-tests.php
npx -y @php-wasm/cli -l models/ServiceModel.php     # single-file lint
```

`npm warn EBADENGINE` is harmless. Do not use `@php-wasm/node` (Node bindings); the CLI package is
the one that exposes `php`.

---

## 3. Route and wiring check

```bash
cd api
php tests/route-check.php
# Routes checked: 129
# Dependency calls checked: 217
# OK — every route handler and dependency method exists.
```

Run this after adding a route, renaming a controller action or changing a model method. It catches
the most common “the endpoint 500s” mistake before deployment, and it is safe in CI (no database).

---

## 4. CLI request smoke

`tests/http-smoke.php` dispatches one request through the real router, middleware and controller,
then prints the JSON body and `STATUS:<code>` on stderr. It is **not** an HTTP client — no server or
network is involved.

```bash
cd api

# healthy host
php tests/http-smoke.php GET /v1/health
# { "data": { "status": "ok", … } }
# STATUS:200

# unknown route
php tests/http-smoke.php GET /v1/does-not-exist
# STATUS:404

# wrong verb
php tests/http-smoke.php DELETE /v1/health
# STATUS:405

# write + JSON body (needs the database; without it the runner reports 500)
php tests/http-smoke.php POST /v1/leads '{"name":"Test","email":"test@example.com","message":"Please call me about a roof leak."}'
# provisioned host: STATUS:201; no database: STATUS:500

# third argument is always raw JSON
php tests/http-smoke.php POST /v1/analytics/events '{"events":[{"event_type":"page_view","path":"/"}]}'
```

Without `.env`/MySQL most data routes return `500` or `503` with
`"Database credentials are not configured"`. That is the expected result on a machine with no
database; only `/v1/health` has a meaningful degraded answer (`503`, `"database":"unavailable"`).

Exit status: the runner exits `0` after dispatch regardless of the HTTP status, so read
`STATUS:<code>` from stderr in scripts.

---

## 5. Manual checklist on a provisioned host

Run once after the import, then after any change to auth, analytics or uploads.

### Public

- [ ] `GET /api/v1/health` → `200`, `"database":"connected"`
- [ ] `GET /api/v1/services` → 15 services; every item has `phone_group_ids`
- [ ] `GET /api/v1/services?full=1` → detail bodies + `phone_groups` with numbers
- [ ] `GET /api/v1/services/roofing` → two numbers, primary first
- [ ] `GET /api/v1/phone-groups` → 10 groups, `active_number_count` correct
- [ ] `GET /api/v1/settings` → 33 flat keys; no admin-only keys
- [ ] `GET /api/v1/faqs` → two groups (`home`, `how-it-works`)
- [ ] `GET /api/v1/integrations` → snippets empty until configured
- [ ] `GET /api/v1/sitemap` → entries; disable `sitemap_enabled` and expect `404`
- [ ] `POST /api/v1/leads` valid → `201` + `reference`; invalid → `422` with `error.fields`
- [ ] Submit the same lead 6 times → `429`
- [ ] `POST /api/v1/analytics/events` with 3 valid events → `{ "accepted": 3 }`
- [ ] Send `call_click` with another trade's number → rejected (no row)
- [ ] `POST /api/v1/analytics/events` with a `purchase` event → `422` (unknown type)

### Auth

- [ ] Login correct → `200`, both cookies set (`HttpOnly` on the session)
- [ ] Login wrong password 5× → `429` lockout; wait 15 min or clear `rate_limits`
- [ ] `GET /v1/auth/session` with cookie → `200`, `expires_at` in the future
- [ ] `PUT /v1/admin/settings` **without** `X-CSRF-Token` → `403 csrf_failed`
- [ ] Same with the header → `200`; refresh the admin page and confirm the value persisted
- [ ] Logout → cookie cleared; `GET /v1/auth/session` → `401`

### Admin CRUD (one per resource)

- [ ] Service: create, edit, reorder groups, delete, restore
- [ ] Phone number: create with `status: inactive` → absent from `/v1/services/{slug}/numbers`;
      set to `active` → appears
- [ ] Category/niche/blog post/page/FAQ/homepage section: create → edit → delete
- [ ] Settings save → public `/v1/settings` reflects the change after cache purge
- [ ] SEO save → `/v1/seo` reflects it
- [ ] Upload a 1 MB JPEG → `url` loads in the browser; upload a `.svg` → `422`; delete → file gone
- [ ] Role test with a `viewer` account: every write returns `403`

### Analytics integrity

- [ ] Click a Call Now button on the site → `analytics_events` gains a `call_click`
- [ ] Admin → Analytics shows the click, but connected calls stay `0`
- [ ] `POST /v1/admin/calls` twice with the same `external_call_id` → one row (updated, not duplicated)
- [ ] Add revenue → dashboard total increases by exactly that amount
- [ ] Clear analytics events → dashboard shows zeros, not invented numbers

### Maintenance

- [ ] `php tools/maintenance.php` → deletes only expired rows; content untouched
- [ ] Re-import `database/schema.sql` on a staging copy → import succeeds with no FK errors

---

## 6. What is not automated

* No MySQL in the development sandbox — SQL was validated by parsing and by column/method checks,
  not by executing queries. The checklist above is the authoritative end-to-end test.
* No browser or device-lab automation. The frontend suites use server-side rendering plus pure
  functions; responsive behaviour and real cookie flows need a manual pass.
* No load testing. Rate limits are fixed-window counters; if you expect spikes, test on staging
  with your host's PHP-FPM worker limits in mind.
