# Security Model

This document describes what the API does to protect the site, the admin console and the data it
holds — and which protections are the host's or the operator's responsibility.

---

## 1. Transport and headers

* All admin traffic must run over HTTPS. Session cookies are `Secure` by default
  (`COOKIE_SECURE=true`). Turning HTTPS off is a deployment mistake, not a supported mode.
* Every JSON response sends `X-Content-Type-Options: nosniff` and `Content-Type: application/json;
  charset=utf-8`.
* Admin responses send `Cache-Control: no-store, private`. Public reads may be cached only when
  `PUBLIC_CACHE_TTL > 0`.
* `.htaccess` adds `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a
  `Permissions-Policy` that disables geolocation, microphone and camera. The API page is not
  embeddable.
* `Server`, `X-Powered-By` and PHP error output are suppressed in production (`APP_DEBUG=false`).

---

## 2. Authentication

| Control | Implementation |
| --- | --- |
| Password storage | bcrypt, cost 12 (`password_hash` / `password_verify`) |
| Session cookie | `shn_admin_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| Session storage | `admin_sessions.token_hash` = SHA-256 of a 32-byte random token; the raw token exists only in the cookie |
| Lifetime | 8 hours; 30 days with “remember me”; idle timeout 2 hours |
| Session cap | 10 concurrent sessions per admin (oldest revoked) |
| Login throttling | 5 attempts / 15 min per IP **and** 5 failures per account → 15-minute lock |
| Enumeration | Unknown email and wrong password return the same `401` and message |
| Logout | Deletes the session row server-side; cookie is cleared |
| Password reset | 32-byte token, stored only as SHA-256, single use, 60-minute expiry, 3 requests/hour/IP |
| Password change | Requires the current password, invalidates other sessions, updates `password_changed_at` |

Changing `APP_KEY` does not sign cookies (they are random tokens) but it does invalidate reset
tokens and CSRF secrets derived from it.

---

## 3. Authorisation (RBAC)

Four roles, strictly ordered: `owner` > `admin` > `editor` > `viewer`.

| Capability | owner | admin | editor | viewer |
| --- | --- | --- | --- | --- |
| Read every screen | ✓ | ✓ | ✓ | ✓ |
| Create/edit content, services, numbers, pages, blog, FAQs, media | ✓ | ✓ | ✓ | — |
| Record calls, revenue and rebuild analytics | ✓ | ✓ | — | — |
| Settings, integrations, SEO | ✓ | ✓ | — | — |
| Manage team | ✓ | ✓ | — | — |
| Delete phone groups, homepage sections, FAQ groups, leads | ✓ | ✓ | — | — |

Rules enforced in code, not just the UI:

* `admin` cannot demote, lock or delete the last `owner`.
* An admin cannot delete or demote themselves.
* Unknown or missing role claims fail closed (`401`/`403`).
* The public API never exposes an admin field, and admin routes never leak through the public
  prefix.

---

## 4. CSRF

* Login and `GET /v1/auth/session` issue a CSRF token: a 32-byte random value in the readable
  `shn_csrf` cookie (`SameSite=Lax`), stored in `admin_sessions.csrf_hash` as SHA-256.
* Every `POST`/`PUT`/`PATCH`/`DELETE` under `/v1/auth/*` and `/v1/admin/*` requires
  `X-CSRF-Token` matching the session's stored hash, compared with `hash_equals`.
* Missing or wrong token → `403 csrf_failed`; the request never reaches the controller.
* The public `POST /v1/leads` and `POST /v1/analytics/events` endpoints are cookie-less and
  therefore exempt; they are protected by rate limits and validation instead.

## 5. CORS

`CORS_ALLOWED_ORIGINS` is an explicit allow-list. The API:

* echoes only an allowed `Origin`,
* sends `Access-Control-Allow-Credentials: true` and `Vary: Origin`,
* never pairs `*` with credentials,
* rejects a disallowed origin on credentialed preflights.

`GET`/`POST` from unknown origins still work without cookies (public reads), which is required for
the sitemap and simple integrations. Anything authenticated requires an allowed origin.

---

## 6. Input validation

* Every write goes through `Validator` with explicit rules (`required`, `string|max:…`,
  `in:…`, `bool`, `date`, `email`) — no mass assignment of arbitrary columns.
* Writable fields are a fixed list per resource; unknown keys are ignored, never mapped to SQL.
* All SQL uses prepared statements with bound parameters. `LIMIT` values are cast to bounded
  integers before interpolation (no user string ever reaches the SQL text).
* IDs are validated as positive integers (`404` for garbage, not a cast to 0).
* Slugs are normalised and checked for uniqueness; duplicates return `409`.
* JSON bodies are limited in size, and malformed JSON returns `400 bad_request`.

---

## 7. Output safety

The public site is server-rendered React, so stored HTML is dangerous in exactly one place: the
tracking snippets.

### Script policy (`header_scripts`, `footer_scripts`)

`Security::validateSnippet()` runs on save, on the preview endpoint and again when the public
`/v1/integrations` endpoint reads the value. A snippet is accepted only when all of these hold:

* it is at most 8,000 characters;
* it contains no dangerous tokens (`document.cookie`, `document.write`, `localstorage`, `eval(`,
  `atob(`, `import(` — the full list lives in `Security::DANGEROUS_PATTERNS`);
* every `<script src>` is an `https://` URL on an approved analytics host
  (`googletagmanager.com`, `google-analytics.com`, `google.com`, `gstatic.com`, `clarity.ms`,
  `facebook.net`, … — extend with `SCRIPT_HOSTS` in `.env`);
* every inline `<script>` body references a recognised analytics/tag-manager API;
* **every tag** is one of `script`, `meta`, `link`, `style`, `noscript` — `<div>`, `<iframe>`,
  `<form>`, `<base>` and the rest are rejected;
* a `google-site-verification` meta tag is only accepted in the header slot.

The browser-embedded copy of the site also filters snippets with the same tag allow-list
(`src/lib/api/runtimeConfig.ts`) before injecting them, and sets Google's verification tag through
the document head instead of `innerHTML`.

Plain text fields (site name, FAQ copy, titles) are rendered as text by React. Rich-text fields
(page and blog bodies) are cleaned server-side by `Security::sanitizeHtml()`: only a fixed tag list
(`p`, `br`, `strong`, `em`, lists, headings, `blockquote`, `a`, `img`, `figure`, `table`, `code`,
…) survives, attributes are restricted per tag, `href`/`src` must pass `isSafeUrl()`, unknown
wrappers are unwrapped, and comments are dropped.

`google_verification` must match a Google-issued token pattern; `analytics_id` must match
`G-XXXXXXX` or `GTM-XXXXXX`. `og_image` must be a relative path or an `https://` URL.

---

## 8. Uploads

* Allowed: JPEG, PNG, WebP, GIF. SVG is rejected (it can carry script).
* Size limit: `UPLOAD_MAX_BYTES` (default 5 MB).
* Content is verified with `getimagesize()` and the MIME type from `finfo`, not the client header.
* Stored under a generated name (`/uploads/library/YYYY/MM/<random>.<ext>`); the original filename
  is never used as a path.
* `uploads/.htaccess` denies execution of PHP, PHAR, CGI and HTML files and disables directory
  listing. Uploads are served as static files only.
* Deleting a media row deletes the file, and the API refuses paths outside the configured upload
  directory (path-traversal guard).

---

## 9. Data minimisation & integrity

* Lead IPs are stored as an HMAC fingerprint (`Security::fingerprintIp`), never as plain IP text.
  The raw IP is used only in the rate-limit bucket (hashed) and never logged.
* User agents are truncated; no cookies are copied into analytics events.
* Analytics events from the browser are limited to `page_view`, `service_click`, `call_click`. The
  server drops unknown types and rejects clicks that reference unknown services/numbers.
* Email addresses are never exposed by public endpoints. Team listings are admin-only.
* Audit logging records actor, action, entity, summary and IP fingerprint for every write. Passwords
  and tokens are never included.
* Retention: analytics events are pruned after `ANALYTICS_RETENTION` days (default 400) by
  `tools/maintenance.php`; audit rows after `AUDIT_RETENTION` (365).

---

## 10. Error handling and logging

* Exceptions are converted to the JSON envelope. In production the message is generic
  (`server_error`); details go to `api/storage/logs/php-error.log`.
* Validation errors list field messages but never echo other input.
* The log never contains passwords, session tokens, CSRF tokens, full request bodies or raw IPs.
* Database errors are logged with a correlation message; the client sees
  “The request could not be completed.”

---

## 11. Rate limiting and abuse

Fixed-window counters in `rate_limits` (keyed by route bucket + HMAC of the IP) provide:

* login lockout (per IP + per account),
* lead spam limits (5 / 10 min / IP),
* analytics flood limits (60 / min / IP),
* public read limits (240 / min / IP),
* admin write limits (120 / min).

`HoneypotService` rejects a lead submission when the hidden `website` field is filled or when the
form is submitted less than 2 seconds after it was rendered (`form_started_at`). The response is a
normal `422` with a generic “please reload” message.

If the database is unreachable the limiter fails open for health checks and fails closed for
writes — a degraded database never means “allow unlimited logins”.

---

## 12. Deployment checklist

- [ ] `APP_ENV=production`, `APP_DEBUG=false`
- [ ] HTTPS enforced; `COOKIE_SECURE=true`
- [ ] `APP_KEY` set and backed up
- [ ] Seeded admin password changed; team accounts use unique passwords
- [ ] `CORS_ALLOWED_ORIGINS` lists only your real origins
- [ ] `.env` outside `public_html` (Layout A) or denied by `.htaccess`
- [ ] `storage/` and `uploads/` not browsable; PHP denied in `uploads/`
- [ ] Database user limited to this schema; no `GRANT ALL` to other schemas
- [ ] `tools/maintenance.php` on a daily cron
- [ ] `RATE_*` reviewed for your traffic
- [ ] Backups: database nightly, uploads weekly, `.env` kept separately

---

## 13. Known limitations

* Shared hosting means PHP runs as your user; a compromised account compromises the site. Keep
  cPanel and PHP patched.
* There is no WAF or bot-detection service. If lead spam becomes a problem, put Cloudflare in front
  and keep the honeypot + rate limits.
* Password reset email depends on `mail()`; on hosts that block it, configure SMTP at the host
  level.
* `SameSite=Lax` cookies require the admin console and API to share an origin for a smooth
  experience. Cross-origin deployments work only in browsers that accept third-party cookies —
  same-origin deployment is strongly recommended.
