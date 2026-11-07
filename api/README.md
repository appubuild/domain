# Safe Home Network — PHP 8 API

A dependency-free PHP + MySQL backend for the Safe Home Network website. It serves the public
content that used to be bundled in the React app, collects first-party analytics and leads, and
backs the admin console.

* **No Composer, no framework.** Plain PHP 8.1+ classes with a small router, PDO and prepared
  statements. Upload the folder and it runs.
* **One schema.** 22 tables, imported through phpMyAdmin (`database/safehomenetwork.sql`).
* **Cookie sessions + CSRF.** HttpOnly session cookie, readable CSRF cookie, SHA-256 token at rest.
* **Honest analytics.** Button clicks are recorded as clicks. Connected calls and revenue enter
  only through `POST /v1/admin/calls` and `POST /v1/admin/revenue` — nothing is estimated.
* **Fails safe.** A missing database degrades `/v1/health` to `503` and never fakes content.

---

## Quick start (hosting)

1. Read [`docs/INSTALLATION.md`](docs/INSTALLATION.md) — cPanel/Hostinger upload, phpMyAdmin
   import, `.env`, permissions, HTTPS, CORS.
2. Import `database/safehomenetwork.sql`.
3. Copy `.env.example` → `.env` (one level above `public_html` if you can) and fill in the database
   credentials, `APP_URL`, `SITE_URL` and `CORS_ALLOWED_ORIGINS`.
4. `curl https://your-domain.com/api/v1/health` → `{"data":{"status":"ok",…}}`.
5. Sign in at `/admin` with the seeded owner account and **change the password immediately**.

## Quick start (local)

```bash
cd api
cp .env.example .env          # then set DB_* and COOKIE_SECURE=false for http://localhost
php -S localhost:8080 index.php   # or point Apache/Laravel Herd at this folder
curl -s http://localhost:8080/v1/health
```

The route table lives in `routes/api.php` and is loaded by `index.php`; nothing is auto-discovered.
All paths are prefixed with `/v1`.

## Layout

```
api/
├── index.php              front controller (boot, CORS, dispatch, errors)
├── .htaccess              rewrite to index.php + security headers + file denies
├── config/                application, database, security defaults from .env
├── helpers/               Router, Request, Response, Validator, Security, Logger, Config, Env
├── middleware/            Auth, Role, CSRF, CORS, RateLimit
├── models/                one class per table family; all SQL lives here
├── controllers/           public + admin endpoints, no SQL
├── services/              analytics ingest, honeypot
├── routes/api.php         129 routes
├── database/
│   ├── schema.sql         tables, indexes, foreign keys
│   ├── seed.sql           content seed
│   └── safehomenetwork.sql  schema + seed for phpMyAdmin (import this)
├── tests/
│   ├── run-tests.php      dependency-free unit suite (56 assertions)
│   ├── route-check.php    verifies every route handler and model method exists
│   └── http-smoke.php     dispatch one request through the real router
├── tools/maintenance.php  cron: prune sessions, resets, rate limits, old events
└── docs/
    ├── INSTALLATION.md    hosting guide
    ├── API-REFERENCE.md   every endpoint, field and error
    ├── SECURITY.md        auth, RBAC, CSRF, uploads, snippet policy
    └── TESTING.md         how to test, and what is manual
```

## Verification

```bash
php tests/run-tests.php      # 56 passed, 0 failed
php tests/route-check.php    # 129 routes, 217 dependency calls
php tests/http-smoke.php GET /v1/health
php tests/http-smoke.php GET /v1/does-not-exist   # STATUS:404
php -l models/ServiceModel.php
```

On a host without PHP, the WASM CLI works:

```bash
npx -y @php-wasm/cli tests/run-tests.php
```

## Content contract with the frontend

The site reads, in this order, when `VITE_API_BASE_URL` is set:

| Endpoint | Used for |
| --- | --- |
| `/v1/services?full=1` | service pages, categories, the phone-group mapping |
| `/v1/phone-groups` | group metadata and active-number counts |
| `/v1/settings` | site name, contact details, socials, hours, timezone |
| `/v1/faqs` | homepage and How It Works FAQ lists |
| `/v1/integrations` | GA4/GTM id, Google verification, header/footer snippets |
| `/v1/seo` | default title/description, robots, canonical base, OG image |
| `POST /v1/analytics/events` | page views, service clicks, call clicks |
| `POST /v1/leads` | contact form |

Any of these failing leaves the site on its bundled content for that slice — a missing API never
produces an empty page. See `../docs/API-INTEGRATION.md`.

## Seed accounts and data

* Owner: `info@safehomenetwork.com` / `Sa123456` — change after the first login.
* 15 services, 5 categories, 10 phone groups, 20 numbers, 12 pages, 6 posts, 8 homepage sections,
  12 FAQs, 33 settings.

## License

Private project — all rights reserved by the site owner.
