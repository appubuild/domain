# API overview

The site can run entirely static, or read its content from the PHP 8 + MySQL API in
[`api/`](api/README.md). This file is the map; the detail lives in the linked docs.

| Question | Answer |
| --- | --- |
| Where is the backend? | `api/` — dependency-free PHP 8.1+, no Composer |
| How do I install it? | [`api/docs/INSTALLATION.md`](api/docs/INSTALLATION.md) — phpMyAdmin import, `.env`, permissions, HTTPS, CORS |
| What endpoints exist? | [`api/docs/API-REFERENCE.md`](api/docs/API-REFERENCE.md) — 129 routes under `/v1` |
| How is it secured? | [`api/docs/SECURITY.md`](api/docs/SECURITY.md) — cookie sessions, CSRF, RBAC, rate limits, snippets, uploads |
| How do I test it? | [`api/docs/TESTING.md`](api/docs/TESTING.md) — 56 unit assertions, route check, CLI smoke, manual DB checklist |
| How does the site use it? | [`docs/API-INTEGRATION.md`](docs/API-INTEGRATION.md) — `VITE_API_BASE_URL`, per-slice fallback, admin switch |
| Production build | `VITE_API_BASE_URL=https://your-domain.com/api npm run build` |

## Conventions at a glance

* Base URL ends with `/api`; every route is prefixed `/v1` (so `GET /api/v1/health`).
* Responses are `{"data": …}` (with `meta` for lists), errors are
  `{"error": {"code", "message", "fields?"}}`.
* Admin routes need the `shn_admin_session` HttpOnly cookie and, on writes, the
  `X-CSRF-Token` header matching the `shn_csrf` cookie.
* Roles: `owner` > `admin` > `editor` > `viewer`. Most content writes are `editor`.
* Timestamps are UTC RFC 3339; dates in filters are `YYYY-MM-DD`.
* Clicks (`analytics_events`) and connected calls (`call_records`) are different
  numbers and are never derived from each other.

## Database

One import file: `api/database/safehomenetwork.sql` (22 tables + seed). Seeded owner:
`info@safehomenetwork.com` / `Sa123456` — change it right after the first login.
