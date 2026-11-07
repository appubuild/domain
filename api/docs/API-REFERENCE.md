# Safe Home Network API — Reference

Base URL: `https://safehomenetwork.com/api` — every route below is prefixed with `/v1`.

* `GET /api/v1/health` → `https://safehomenetwork.com/api/v1/health`
* Unless stated otherwise, requests and responses are JSON (`Content-Type: application/json`).
* The only non-JSON endpoint is `POST /v1/admin/media` (multipart upload).

---

## 1. Conventions

### Envelope

Every success response is one of:

```json
{ "data": { … } }
{ "data": [ … ], "meta": { "source": "database", "generated_at": "2026-11-07T12:00:00+00:00" } }
```

Admin collections add pagination:

```json
{
  "data": [ … ],
  "meta": { "page": 1, "per_page": 25, "total": 42, "total_pages": 2 }
}
```

### Errors

```json
{
  "error": {
    "code": "validation_failed",
    "message": "The given data was invalid.",
    "fields": { "email": "Enter a valid email address." }
  }
}
```

| Status | Code examples | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed JSON |
| 401 | `unauthenticated`, `session_expired` | No/expired session |
| 403 | `forbidden`, `csrf_failed`, `origin_not_allowed` | Role, CSRF or CORS rejection |
| 404 | `not_found` | Unknown route or record |
| 405 | `method_not_allowed` | Wrong verb |
| 409 | `conflict` | Duplicate slug / already exists |
| 422 | `validation_failed`, `unprocessable` | Field errors in `error.fields` |
| 429 | `rate_limited` | Slow down (`Retry-After` header) |
| 500 | `server_error` | Check the log |
| 503 | `service_unavailable`, `degraded` | Database down or maintenance mode |

`error.fields` is only present for validation errors. Never rely on the message text — switch on
`code`.

### Authentication

Admin routes require a session. Sign in with `POST /v1/auth/login`; the API answers with an
`HttpOnly` cookie (`shn_admin_session`) and a readable CSRF cookie (`shn_csrf`). Send the CSRF
value in `X-CSRF-Token` on every `POST`, `PUT`, `PATCH` and `DELETE`.

```bash
# 1. sign in (cookie jar keeps both cookies)
curl -c jar.txt -s -X POST https://safehomenetwork.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"info@safehomenetwork.com","password":"Sa123456","remember":true}'

# 2. read the CSRF cookie and send it on writes
CSRF=$(awk '$6=="shn_csrf" {print $7}' jar.txt)
curl -b jar.txt -s -X PUT https://safehomenetwork.com/api/v1/admin/settings \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"settings":{"site_name":"Safe Home Network"}}'
```

Browser clients do not set the header by hand — the frontend reads the cookie. Sessions expire
after 8 hours (30 days with `remember`), are dropped after 2 hours of inactivity, and are bound
to a hash of the session token in the database. `GET /v1/auth/session` refreshes the idle timer.

### Pagination, filtering, sorting

* `page` (default 1) and `per_page` (default 20–25, max 100) — admin collections only.
* `q` — free-text search where the resource supports it.
* Resource-specific filters are listed per endpoint.
* Sorted newest-first by default; nothing accepts arbitrary SQL sort parameters.

### Rate limits

| Bucket | Default |
| --- | --- |
| Public reads (`rate:read`) | 240 requests / minute / IP |
| Lead submissions | 5 / 10 minutes / IP |
| Analytics events | 60 / minute / IP |
| Login | 5 / 15 minutes / IP + account lockout (5 failures) |
| Password reset | 3 / hour / IP |
| Authenticated admin writes | 120 / minute |

Limits live in `.env` (`RATE_*`). `429` responses include `Retry-After` in seconds.

---

## 2. Public endpoints

No authentication. All are rate-limited.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/v1/health` | Version, PHP, database state. `200` healthy, `503` degraded |
| GET | `/v1/services` | Published services. `?full=1` adds detail bodies and `phone_groups` |
| GET | `/v1/services/{slug}` | One published service with numbers and related services |
| GET | `/v1/services/{slug}/numbers` | The numbers assigned to that service (primary first) |
| GET | `/v1/categories` | Published categories with service counts |
| GET | `/v1/niches` | Niche/trade taxonomy |
| GET | `/v1/phone-groups` | Group index — names, labels, active-number counts. **Numbers are omitted** |
| GET | `/v1/pages` | Published static pages (index) |
| GET | `/v1/pages/{slug}` | One page with body blocks |
| GET | `/v1/blog/categories` | Blog categories |
| GET | `/v1/blog/tags` | Blog tags |
| GET | `/v1/blog` | Published posts (`page`, `per_page`, `category`, `tag`, `q`) |
| GET | `/v1/blog/{slug}` | One published post |
| GET | `/v1/homepage` | Homepage sections + FAQ groups + categories + public settings |
| GET | `/v1/faqs` | FAQ groups (`home`, `how-it-works`) with visible questions |
| GET | `/v1/settings` | Public settings as a flat `key: value` object |
| GET | `/v1/integrations` | GA4/GTM id, Google verification, header/footer snippets, maintenance flag |
| GET | `/v1/seo` | Default title/description, robots, canonical base, OG image, sitemap flag |
| GET | `/v1/sitemap` | Sitemap entries (404 when disabled in settings) |
| POST | `/v1/leads` | Submit a contact/quote request |
| POST | `/v1/analytics/events` | Record one event or a batch of up to 20 |

### GET /v1/services

```json
{
  "data": [
    {
      "id": 3,
      "slug": "roofing",
      "name": "Roofing",
      "category": { "id": "exterior", "name": "Roofing & Exterior" },
      "icon": "home",
      "featured": true,
      "hero_headline": "Roof repair, replacement and storm damage",
      "short_description": "Connect with independent roofing contractors…",
      "phone_group_ids": ["roofing"],
      "updated_at": "2026-11-01T09:00:00+00:00"
    }
  ],
  "meta": { "source": "database", "generated_at": "…" }
}
```

`?full=1` replaces `phone_group_ids` with the full detail body (`intro`, `common_needs`,
`options`, `process_note`, `faqs`, `related`, `search_terms`, `meta_title`, `meta_description`)
plus `phone_groups`:

```json
"phone_groups": [
  {
    "id": "roofing",
    "name": "Roofing",
    "label": "Roofing",
    "blurb": "Storm damage, leaks and full replacements.",
    "icon": "home",
    "numbers": [
      {
        "id": 4,
        "external_id": "roofing-primary",
        "number": "800-779-3921",
        "label": null,
        "priority": 1,
        "priority_label": "Call Now",
        "tel": "tel:+18007793921"
      }
    ]
  }
]
```

Only active, non-deleted numbers are returned, and only for groups that actually have one. A
service whose trade has no published number reports an empty list: the UI shows the contact form
instead of borrowing another trade's line.

### GET /v1/phone-groups

```json
{
  "data": [
    {
      "id": "roofing",
      "name": "Roofing",
      "label": "Roofing",
      "blurb": "Storm damage, leaks and full replacements.",
      "icon": "home",
      "has_active_numbers": true,
      "active_number_count": 2
    }
  ]
}
```

### POST /v1/leads

| Field | Required | Rules |
| --- | --- | --- |
| `name` | yes | 2–160 chars |
| `email` | yes | valid email, ≤190 |
| `message` | yes | 10–5000 chars |
| `phone` | no | ≤32 |
| `service` | no | service name or slug, ≤160 |
| `subject` | no | ≤200 |
| `type` | no | `lead` (default) or `support` |
| `consent` | no | boolean |
| `source` | no | ≤60, e.g. `contact-page` |
| `utm_source` / `utm_medium` / `utm_campaign` | no | ≤120 / 120 / 160 |

```json
{
  "data": {
    "reference": "SHN-20261107-4F2A",
    "status": "new",
    "message": "Thank you — your message has been received…"
  }
}
```

The client IP is stored only as an HMAC fingerprint. Submissions are rate-limited and optionally
posted to `LEAD_WEBHOOK_URL`.

### POST /v1/analytics/events

Single event or a batch of up to 20:

```json
{
  "events": [
    {
      "event_type": "page_view",
      "path": "/services/roofing",
      "referrer": "https://www.google.com/",
      "visitor_id": "v_9f1c…",
      "session_id": "s_71ab…",
      "device_type": "mobile",
      "utm_source": "google",
      "utm_medium": "cpc"
    },
    {
      "event_type": "service_click",
      "service_id": 3,
      "path": "/services"
    },
    {
      "event_type": "call_click",
      "service_id": 3,
      "phone_number_id": 4,
      "path": "/services/roofing"
    }
  ]
}
```

Allowed `event_type` values from the browser: `page_view`, `service_click`, `call_click`.
`service_click` requires a known `service_id`; `call_click` requires a known `phone_number_id` that
belongs to the service (or an unclaimed number). Invalid events are dropped, and a batch that
contains no valid event returns `422`. Response:

```json
{ "data": { "accepted": 3 } }
```

> Numbers of accepted events are click counts, not call counts. Connected calls are recorded by the
> network and entered through the admin API (`POST /v1/admin/calls`); the dashboard never derives
> calls from clicks.

---

## 3. Authentication endpoints

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/v1/auth/login` | — | Email + password → session cookie, CSRF token |
| POST | `/v1/auth/logout` | session + CSRF | Revoke the current session |
| GET | `/v1/auth/session` | session | Current admin, permissions, expiry; refreshes idle timer |
| PATCH | `/v1/auth/profile` | session + CSRF | Update own name/email |
| POST | `/v1/auth/password` | session + CSRF | Change own password |
| GET | `/v1/auth/sessions` | session | List own active sessions |
| DELETE | `/v1/auth/sessions/{id}` | session + CSRF | Revoke one of your sessions |
| POST | `/v1/auth/password/forgot` | — | Email a reset link (always `200`) |
| POST | `/v1/auth/password/reset` | — | Consume the token and set a new password |

### POST /v1/auth/login

```json
{ "email": "info@safehomenetwork.com", "password": "…", "remember": true }
```

```json
{
  "data": {
    "admin": { "id": 1, "name": "Site Owner", "email": "info@safehomenetwork.com", "role": "owner" },
    "permissions": ["services.manage", "settings.manage", "…"],
    "csrf_token": "…",
    "expires_at": "2026-12-07T12:00:00+00:00"
  }
}
```

Roles: `owner`, `admin`, `editor`, `viewer`. `viewer` can read everything and cannot write.
Errors: `401 invalid_credentials` (same message for unknown email and wrong password),
`429 account_locked` after 5 failures. Lockout is per account and lasts 15 minutes.

### Password reset

`POST /v1/auth/password/forgot` with `{ "email": "…" }` always answers
`{ "data": { "message": "If that address exists, a reset link has been sent." } }`.
`POST /v1/auth/password/reset` takes
`{ "token": "…", "password": "…", "password_confirmation": "…" }`; tokens are single use,
hashed at rest and expire after 60 minutes.

---

## 4. Admin endpoints

Every route below requires a valid session **and** the CSRF header on writes. Required role is
shown per group; a lower role receives `403 forbidden`.

### Dashboard & audit

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/dashboard` | viewer | Counts, recent leads, directory health, activity |
| GET | `/v1/admin/activity` | viewer | Audit log (`limit` ≤ 200) |

### Services

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/services` | viewer | List. Filters: `q`, `category`, `status`, `featured`, `include_deleted` |
| POST | `/v1/admin/services` | editor | Create |
| GET | `/v1/admin/services/{id}` | viewer | Read |
| PUT | `/v1/admin/services/{id}` | editor | Update |
| DELETE | `/v1/admin/services/{id}` | editor | Soft delete |
| POST | `/v1/admin/services/{id}/restore` | editor | Restore |
| PUT | `/v1/admin/services/{id}/groups` | editor | Replace the phone-group mapping (`{"group_ids":["roofing"]}`) |
| GET | `/v1/admin/services/mapping` | viewer | Service → group mapping with number counts |

Service payload (writable): `name`, `slug`, `short_name`, `category_id`, `icon`, `image`,
`featured`, `status`, `sort_priority`, `hero_headline`, `hero_subheadline`, `short_description`,
`intro` (array of paragraphs), `common_needs` (array of `{title, description}`), `options` (same),
`process_note`, `faqs` (array of `{question, answer}`), `related` (array of slugs),
`search_terms` (array), `meta_title`, `meta_description`. The admin response is a flat record with
`category_name`, `group_ids` and timestamps.

### Phone numbers & groups

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/phone-numbers` | viewer | Filters: `q`, `group`, `status`, `network`, `include_deleted` |
| POST | `/v1/admin/phone-numbers` | editor | Create |
| GET | `/v1/admin/phone-numbers/{id}` | viewer | Read |
| PUT | `/v1/admin/phone-numbers/{id}` | editor | Update |
| DELETE | `/v1/admin/phone-numbers/{id}` | editor | Soft delete |
| POST | `/v1/admin/phone-numbers/{id}/restore` | editor | Restore |
| POST | `/v1/admin/phone-numbers/{id}/verify` | editor | Mark verified (`{"verified":true}`) |
| GET | `/v1/admin/phone-numbers/{id}/services` | viewer | Services using this number |
| GET | `/v1/admin/phone-groups` | viewer | List groups with number counts |
| POST | `/v1/admin/phone-groups` | editor | Create |
| PUT | `/v1/admin/phone-groups/{id}` | editor | Update |
| DELETE | `/v1/admin/phone-groups/{id}` | admin | Delete (refuses when in use) |

Number fields: `number`, `label`, `group_id`, `priority` (1 primary, 2 alternate, 3+),
`status` (`active`, `pending-verification`, `inactive`), `network`, `campaign`, `notes`.

> A number must be **active** before the public API will expose it. Seeded numbers are active but
> carry `pending-verification` only if you change their status — verify ownership with the network
> before publishing a new one.

### Categories & niches

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/categories` | viewer | List |
| POST | `/v1/admin/categories` | editor | Create |
| PUT | `/v1/admin/categories/{id}` | editor | Update |
| DELETE | `/v1/admin/categories/{id}` | editor | Delete (refuses while services exist) |
| GET | `/v1/admin/niches` | viewer | List (`include_deleted`) |
| POST | `/v1/admin/niches` | editor | Create |
| GET | `/v1/admin/niches/{id}` | viewer | Read |
| PUT | `/v1/admin/niches/{id}` | editor | Update |
| DELETE | `/v1/admin/niches/{id}` | editor | Soft delete |
| POST | `/v1/admin/niches/{id}/restore` | editor | Restore |

### Pages

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/pages` | viewer | Filters: `q`, `status`, `template`, `include_deleted` |
| POST | `/v1/admin/pages` | editor | Create |
| GET | `/v1/admin/pages/{id}` | viewer | Read (includes `body` blocks) |
| PUT | `/v1/admin/pages/{id}` | editor | Update |
| DELETE | `/v1/admin/pages/{id}` | editor | Soft delete |
| POST | `/v1/admin/pages/{id}/restore` | editor | Restore |

### Blog

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/blog/categories` | viewer | List |
| POST | `/v1/admin/blog/categories` | editor | Create |
| PUT | `/v1/admin/blog/categories/{id}` | editor | Update |
| DELETE | `/v1/admin/blog/categories/{id}` | editor | Delete |
| GET | `/v1/admin/blog/tags` | viewer | List |
| POST | `/v1/admin/blog/tags` | editor | Create |
| PUT | `/v1/admin/blog/tags/{id}` | editor | Update |
| DELETE | `/v1/admin/blog/tags/{id}` | editor | Delete |
| GET | `/v1/admin/blog` | viewer | Filters: `q`, `status`, `category`, `include_deleted` |
| POST | `/v1/admin/blog` | editor | Create |
| GET | `/v1/admin/blog/{id}` | viewer | Read |
| PUT | `/v1/admin/blog/{id}` | editor | Update |
| DELETE | `/v1/admin/blog/{id}` | editor | Soft delete |
| POST | `/v1/admin/blog/{id}/restore` | editor | Restore |

Post fields: `title`, `slug`, `category_id`, `excerpt`, `body` (markdown-ish text), `featured_image`,
`author`, `status` (`draft`, `scheduled`, `published`), `published_at`, `seo_title`,
`seo_description`, `tag_ids`.

### Homepage sections

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/homepage-sections` | viewer | List (`include_hidden`) |
| POST | `/v1/admin/homepage-sections` | editor | Create |
| GET | `/v1/admin/homepage-sections/{id}` | viewer | Read |
| PUT | `/v1/admin/homepage-sections/{id}` | editor | Update |
| DELETE | `/v1/admin/homepage-sections/{id}` | admin | Delete |
| PUT | `/v1/admin/homepage-sections/order` | editor | Reorder (`{"order":[3,1,2]}`) |

### FAQs

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/faq-groups` | viewer | List groups with counts |
| POST | `/v1/admin/faq-groups` | editor | Create |
| PUT | `/v1/admin/faq-groups/{id}` | editor | Update |
| DELETE | `/v1/admin/faq-groups/{id}` | admin | Delete (refuses while FAQs exist) |
| GET | `/v1/admin/faqs` | viewer | Filters: `group`, `q` |
| POST | `/v1/admin/faqs` | editor | Create |
| GET | `/v1/admin/faqs/{id}` | viewer | Read |
| PUT | `/v1/admin/faqs/{id}` | editor | Update |
| DELETE | `/v1/admin/faqs/{id}` | editor | Delete |

FAQ fields: `group_id` (`home` or `how-it-works`), `question`, `answer`, `sort_order`, `visible`.

### Settings, integrations and SEO

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/settings` | admin | `{groups: {group: [{key, value, type, is_public, …}]}, definitions: […]}` |
| PUT | `/v1/admin/settings` | admin | Body `{"settings": {"site_name": "…"}}`; unknown keys ignored |
| GET | `/v1/admin/settings/seo` | admin | SEO row (also includes `google_verification`, `analytics_id`) |
| PUT | `/v1/admin/settings/seo` | admin | Partial update of the same fields |
| POST | `/v1/admin/settings/integrations/preview` | admin | Validate a snippet without saving |

Snippet preview body: `{"field":"header_scripts","value":"<script…>"}`. Response reports
`valid`, the detected tags, and a `reason` when rejected.

### Leads

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/leads/stats` | viewer | Counts by status and type |
| GET | `/v1/admin/leads` | viewer | Filters: `q`, `status`, `type`, `from`, `to`, `include_deleted` |
| GET | `/v1/admin/leads/{id}` | viewer | Read |
| PUT | `/v1/admin/leads/{id}` | editor | Update `status`, `assigned_to`, `notes` |
| DELETE | `/v1/admin/leads/{id}` | admin | Soft delete |

Lead statuses: `new`, `contacted`, `quoted`, `won`, `lost`, `spam`.

### Analytics, calls and revenue

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/analytics/overview` | viewer | Totals + previous-period comparison for `from`/`to` |
| GET | `/v1/admin/analytics/timeseries` | viewer | Buckets; `granularity` = `day` \| `week` \| `month` |
| GET | `/v1/admin/analytics/sources` | viewer | Traffic sources with visitors, calls, service clicks |
| GET | `/v1/admin/analytics/referrers` | viewer | Referrer hosts |
| GET | `/v1/admin/analytics/landing-pages` | viewer | Path, views, visitors, call clicks |
| GET | `/v1/admin/analytics/campaigns` | viewer | UTM campaigns |
| GET | `/v1/admin/analytics/services` | viewer | Per-service clicks, calls, leads |
| GET | `/v1/admin/analytics/numbers` | viewer | Per-number call clicks, connected calls, status |
| GET | `/v1/admin/analytics/devices` | viewer | Device split |
| GET | `/v1/admin/analytics/daily` | viewer | Daily rollup rows |
| POST | `/v1/admin/analytics/rebuild` | admin | Rebuild the rollup for a range |
| GET | `/v1/admin/calls` | viewer | Recorded calls (`from`, `to`; max 500) |
| POST | `/v1/admin/calls` | admin | Insert/replace a call by `external_call_id` |
| GET | `/v1/admin/revenue` | viewer | Revenue records (`from`, `to`) |
| POST | `/v1/admin/revenue` | admin | Create a revenue record |

All analytics reads accept `from` and `to` (`YYYY-MM-DD`, default last 30 days, max 400 days).

`POST /v1/admin/calls` — required `external_call_id`, `started_at`; optional `phone_number_id`,
`service_id`, `network`, `campaign`, `caller_state`, `duration_seconds`, `connected`,
`recording_url`, `revenue`, `verified`. Repeating an `external_call_id` updates the existing row
(idempotent import).

`POST /v1/admin/revenue` — required `source`, `amount`; optional `call_record_id`, `currency`,
`status` (`pending`, `approved`, `paid`, `void`), `period_start`, `period_end`, `notes`.

> **Integrity rule.** Call and revenue figures only describe rows that were actually recorded.
> `analytics/numbers` reports `call_clicks` (button taps) separately from `connected_calls`
> (records in `call_records`). Nothing on this API estimates calls, revenue or conversions.

### Media

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/media` | viewer | List uploads (`q`, `type`) |
| POST | `/v1/admin/media` | editor | Multipart upload, field `file` (JPEG/PNG/WebP/GIF, ≤5 MB) |
| DELETE | `/v1/admin/media/{id}` | editor | Delete file + row |

Response includes `url` (`/api/uploads/library/2026/11/…`), `width`, `height`, `size`, `mime`.
Uploads are re-encoded only when necessary; SVG and HTML are rejected, and PHP execution inside
the upload folder is denied by `.htaccess`.

### Team

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/v1/admin/team` | admin | List admins |
| POST | `/v1/admin/team` | admin | Invite (`name`, `email`, `role`, `password`) |
| PUT | `/v1/admin/team/{id}` | admin | Update name/role/status |
| DELETE | `/v1/admin/team/{id}` | admin | Remove (cannot remove the last owner) |

Roles: `owner` > `admin` > `editor` > `viewer`. A user cannot demote or delete themselves, and the
last owner cannot be removed.

---

## 5. Caching

Public reads are cache-friendly:

* `Cache-Control: public, max-age=PUBLIC_CACHE_TTL` when `PUBLIC_CACHE_TTL > 0`, otherwise
  `no-store` with a short `ETag`.
* `GET /v1/health` is never cached.
* Admin responses are `no-store`.

If you front the API with a CDN, purge `/api/v1/services`, `/api/v1/phone-groups`,
`/api/v1/settings`, `/api/v1/faqs`, `/api/v1/integrations` and `/api/v1/seo` after a content edit.

---

## 6. Versioning & compatibility

The path prefix is the version (`/v1`). Additive fields may appear at any time; removals or type
changes require `/v2`. Clients must ignore unknown keys. `meta.generated_at` uses RFC 3339 UTC,
and all timestamps are UTC — the site converts to the `timezone` setting for display.
