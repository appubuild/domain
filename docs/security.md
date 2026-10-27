# Security

A static frontend cannot keep a secret. Everything in the bundle is public, so the security
model puts **all authorization in Postgres** and keeps every credential server-side.

---

## 1. Trust boundaries

| Layer | Trust | Enforces |
| --- | --- | --- |
| Static bundle (`out/`) | Public | Nothing. Any check here is UX only. |
| Postgres + RLS | Trusted | Read/write authorization for every table |
| `is_admin()` (SQL) | Trusted | Role membership |
| Supabase Edge Functions | Trusted | Secrets, rate limits, provider calls |
| Browser storage | Untrusted | Favourites, theme, filter state |

The public anon key is *designed* to be in the bundle. It grants only what RLS allows.

---

## 2. Authentication and roles

- Sign-in goes through the provider (`supabase.auth.signInWithPassword`). Credentials never
  touch application code or logs, and there is no custom password store.
- Sessions are persisted by the auth client and refreshed automatically; the admin shell re-checks
  `is_admin()` on load and on every auth state change.
- Roles live in `user_roles` → `app_roles` (`admin`, plus deliberately granular roles). A user
  without `admin` sees an explicit refusal screen, and every admin write is rejected by policy
  anyway.

**Frontend-only auth is never presented as security.** The admin route group renders a gate, and
`docs/admin-guide.md` states plainly that removing the gate exposes empty pages, not data.

### Escalation guards

- Only admins may insert/delete `user_roles` (policy-checked).
- The UI refuses to revoke the last `admin` role.
- `granted_by` records the acting user.

---

## 3. Row-level security

- RLS is **enabled on all 44 public tables**; `tests/db/schema.test.ts` asserts this against a
  real PostgreSQL 18.6 instance (PGlite) and fails if any table is left open.
- Anonymous readers see only `published` content, enabled industries/TLDs and public settings.
- Writes to content require an admin role. User-owned rows (`favorites`, `collections`,
  `saved_searches`) are scoped to `auth.uid()`.
- `audit_logs` is append-only for admins: insert allowed, update/delete not.
- Availability and click tables accept inserts from the app but expose no bulk read to anon.

### The view that bypassed its own policy

`analytics_daily` (migration `0005`) was a plain view. A view runs with its **owner's** rights
unless told otherwise, and its owner is `postgres`, so the aggregate inside it read
`analytics_events` without passing the admin-only RLS policy on that table. The contents were
only counts per day and event type — no paths, no payloads, no session hashes — but the read was
one the policies were meant to refuse, and it was reachable with the public anon key.

Migration `0009` closes it three ways: the view is `security_invoker` (the caller's own RLS now
applies), `anon` loses its `SELECT` grant, and `SELECT` is re-granted to `authenticated` only.
The same migration adds five `security_invoker` reporting functions with `EXECUTE` revoked
**from `PUBLIC`** — PostgreSQL grants `EXECUTE` on a new function to `PUBLIC` by default, so
revoking from `anon` alone would have left the privilege reachable through `PUBLIC`.

Verified on the live project (`bjbbrgjiyoquacoypsia`) after applying:

```
analytics_daily.reloptions        {security_invoker=true}
anon  select on analytics_daily   false
authenticated select              true
5 reporting functions             security_definer = false, anon EXECUTE = false
```

The general lesson generalises past this one view: **any view or function that aggregates a
policy-protected table needs an explicit check**, because both default to running with more
rights than the caller has.

A verified behaviour worth remembering: an RLS-blocked `UPDATE` matches **zero rows silently**.
Tests therefore assert the stored value, not the absence of an error.

---

## 4. Secrets

| Secret | Where it lives | Never |
| --- | --- | --- |
| Supabase service-role key | Edge Function env | browser, repo, build args |
| Registrar / RDAP API keys | Edge Function env | browser |
| AI provider keys | Edge Function env | browser |
| SMTP credentials | Auth provider settings | repo |
| AdSense publisher ID | `ad_settings` (public by nature) | — |

`.gitignore` excludes `.env*` except `.env.example`. The build inlines only `NEXT_PUBLIC_*`
values; `src/lib/config/env.ts` has no accessor for anything else.

---

## 5. Input handling

- **Rich text** passes `sanitizeHtml` on save *and* at render: allowlisted tags/attributes only,
  `script/style/iframe/form/svg/...` removed with their content, event handlers stripped,
  `style` attributes dropped.
- **URLs** pass `sanitizeUrl`: `http`, `https`, `mailto`, `tel` and site-relative paths only.
  `javascript:`, `data:` and protocol-relative `//host` URLs are rejected.
- **JSON-LD** escapes `<` and `>` so data cannot terminate the script element.
- **Generated names** are validated as labels before display or export (length, allowed
  characters, hyphen rules, no leading/trailing hyphen).
- **Affiliate links** are rebuilt and validated before use: `https://` only, `{domain}`
  required (also a database CHECK), the substituted URL's host must match `allowed_hosts`
  exactly or as a subdomain, and credentials/ports are rejected. Look-alike hosts
  (`registrar.example.evil.com`, `registrar.example@evil.com`) are covered by tests. With the
  click-through function deployed, validation happens again server-side from the database, so a
  tampered client cannot send a visitor anywhere new; the redirect carries
  `referrer-policy: no-referrer`.
- **Advertising** is AdSense-only and cannot load operator JavaScript. Gates: provider,
  global switch, script switch, `ca-pub-[0-9]{10,20}` publisher ID, enabled slot with
  `[0-9]{6,25}` unit ID, and consent (required by default). A gate failure renders nothing.
- **Redirects** are validated for shape, self-targeting and real-route shadowing before being
  compiled into host rules.

---

## 6. Abuse resistance

- Availability checks are throttled (concurrency 8, per-provider rate limit column, 429 handling)
  and cached, so the app cannot be used as an RDAP amplifier.
- Exports are generated client-side from results already on screen; there is no unbounded
  server endpoint to hammer.
- Analytics writes carry a rotating salted session hash — no IP address, no user agent.
- Edge Functions that accept public traffic are the place for stricter quotas once deployed;
  this is listed as remaining work rather than claimed.

---

## 7. Privacy

- No third-party analytics, pixels or fonts are loaded.
- Ad scripts load **only** when `ad_settings.global_enabled`, a publisher ID passes the
  `ca-pub-…` constraint, and the slot is enabled. Consent is a switch, not a promise: the site
  does not display ads until a consent flow is configured.
- Click and event tables store a session hash and a path, nothing identifying. The session
  hash is a random per-tab id in `sessionStorage`; it is not a fingerprint, is not derived from
  anything about the device, and disappears when the tab closes.
- Public page views are counted client-side and **honour Do Not Track**; `/admin` is never
  counted. The event vocabulary is fixed by a table constraint, so a payload cannot introduce a
  new event type.

---

## 8. Known gaps

1. No CSP header is generated yet; `.htaccess` could carry one once the final asset and ad
   origins are known.
2. Rate limiting for Edge Functions is designed but unverified here (no deployment).
3. No 2FA enforcement for admins — rely on the provider's MFA settings.
4. `npm audit` reports 2 advisories (moderate `next` 15.5.x, high transitive `postcss`);
   resolving them requires a major Next.js upgrade and is tracked, not hidden.
5. The sanitizer is allowlist-based but hand-written; it is unit-tested against common XSS
   vectors, not formally proven. Treat rich text as admin-trusted input and keep the admin
   role narrow.
