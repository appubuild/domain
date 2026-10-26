# Admin guide

Everything in the admin area writes to the same Postgres database that the public site is
built from. Two rules shape the whole design:

1. **The UI gate is not the security boundary.** `AdminShell` decides which screens to
   render. Authorization is enforced by row-level security and the `is_admin()` function in
   `supabase/migrations/0006_policies.sql`. Bypassing the UI yields empty pages and rejected
   writes, not data.
2. **Publishing is a rebuild.** A static export is immutable bytes on a web server. Saving in
   the admin panel changes the database; the public site changes on the next `npm run build`.

---

## 1. First run

```bash
# 1. Apply schema + seed to your Supabase project
supabase link --project-ref <ref>
supabase db push --include-seed

# 2. Create your account (Supabase dashboard → Authentication → Users → Add user)
#    Disable public sign-ups unless you want reader accounts.

# 3. Grant yourself the admin role (SQL editor)
insert into public.user_roles (user_id, role_id)
values ('<your-auth-user-uuid>', 'admin');

# 4. Build with credentials
cp .env.example .env.local        # fill in URL, anon key, canonical origin
npm run build                     # → out/
```

Sign in at `/admin/login/`. The session lives in the auth provider; `is_admin()` is re-checked
on load and on every token refresh. Accounts without the role see an explicit "no administrator
role" screen, not a broken dashboard.

**Locking yourself out.** The panel refuses to revoke the last `admin` role. If you lose the
password anyway, reset it in the Supabase dashboard and re-grant the role with SQL — no build
required.

---

## 2. Modules

| Group | Module | Table | What it changes |
| --- | --- | --- | --- |
| Overview | Dashboard | — | Live counts and recent audit entries |
| Overview | Analytics | `analytics_events`, `click_events` | First-party event counts, top paths, clicked domains |
| Overview | Audit log | `audit_logs` | Append-only record of admin writes |
| Domain brain | Dictionary | `dictionary_terms` | Words, morphemes, synonyms and exclusions used by expansion |
| Domain brain | Word libraries | `word_libraries` | Prefix/suffix affix pools |
| Domain brain | Phrase templates | `phrase_templates` | Composition patterns (root + industry, prefix + root, …) |
| Domain brain | Industries | `industries` | Industry taxonomy, semantic weight, landing-page copy |
| Naming & scoring | Scoring profiles | `scoring_profiles` | Versioned weight sets for quality and brandability |
| Naming & scoring | Brandable profiles | `brandable_profiles` | Length, syllables, styles, originality bias |
| Naming & scoring | Exclusion rules | `excluded_rules` | Substring / word / regex blocks and warnings |
| Extensions | Domain extensions | `tlds` | Which TLDs are offered and how they can be checked |
| Availability | Providers | `availability_providers` | RDAP endpoints, timeouts, rate limits |
| Monetization | Affiliate providers | `affiliate_providers` | `{domain}` templates, allowlisted hosts, disclosure |
| Monetization | Ad placements | `ad_slots` | Slot keys, page templates, placements, unit IDs |
| Monetization | Ad settings | `ad_settings` | Global ad switch, publisher ID, consent, test mode |
| Content | Pages | `pages` | CMS pages at `/{slug}` |
| Content | Blog posts | `posts` | Articles at `/blog/{slug}` |
| Content | Blog categories | `post_categories` | Post grouping |
| Content | Redirects | `redirects` | Compiled into `out/.htaccess` and `out/_redirects` |
| SEO | SEO templates | `seo_templates` | Title/description patterns per entity |
| Access | Users & roles | `user_roles`, `app_roles` | Who may administer |
| System | Settings | `site_settings` | Brand, SEO defaults, feature switches |
| System | Feature flags | `feature_flags` | Optional capabilities (AI studio, accounts, …) |

### Versioned configuration

`scoring_profiles` is keyed by `(id, version)`. Editing version 1 in place would silently
change the meaning of every score you already published. Instead:

1. `New scoring profile` → same `id`, `version = 2`, adjusted weights.
2. Save, then deactivate version 1 (`is_active = false`).

Ranking reads the highest active version at request time, so new generations use the new
weights while old results remain explainable. Weights that do not sum to 1 are rejected by the
engine's loader; the profile is skipped and the generator diagnostics say so.

### Content fields

Rich text is sanitised **on save** (allowlist tags/attributes, no `<script>`, `<iframe>`,
`<form>`, no `javascript:` or protocol-relative URLs) and **again at render**. The sanitiser is
covered by unit tests in `tests/content/content.test.ts`.

Slugs are immutable through the UI. Renaming a published slug is a redirect decision, not a
field edit: create the new page, add a `redirects` row, publish, rebuild.

---

## 3. Publish workflow

```
edit in /admin/  →  database updated  →  npm run build  →  upload out/  →  live
```

`npm run build` runs `next build` and then `scripts/emit-redirects.ts`, which compiles the
`redirects` table into host configuration:

| File | Used by | Contents |
| --- | --- | --- |
| `out/.htaccess` | Apache / shared hosting | Canonical host + protocol, redirect rules, 404 handler, `Options -Indexes` |
| `out/_redirects` | Netlify, Cloudflare Pages | `source target status` lines |
| `out/redirects.json` | Audits | Machine-readable copy incl. generation timestamp |

The emitter refuses to compile rules that would shadow real routes (`/_next`, `/admin`,
`/api`), self-redirect, or use anything other than 301/302/307/308. Redirect rows are optional:
with no database connection the emitter still writes the host rules and says in the build log
that no database rules were included.

### Rollback

| Level | How |
| --- | --- |
| Content | Revert the page in the admin panel and rebuild |
| Redirects | Disable the row (`enabled = false`), rebuild |
| Schema | Restore the Supabase backup taken before `db push` |
| Release | Re-upload the previous `out/` artifact — it is self-contained |

Keep the previous `out/` directory. It is the whole application: HTML, CSS, JS, redirects.

---

## 4. Operations

**Audit log.** Every create/update/delete through the panel writes an entry with actor,
entity and a payload summary. The table is append-only for admins; there is no delete control
by design. Use SQL if you must purge old rows.

**Analytics.** Counts come from stored events only. When a range holds more than 5,000 events
the page says the window is truncated instead of presenting a partial number as a total. No
third-party tracker is loaded anywhere in the app.

**Availability cache.** `availability_cache` holds provider answers with a TTL (6 hours for
verified results, 10 minutes for inconclusive ones). Clearing rows forces fresh lookups; the
generator never presents a cached `unknown` as `available`.

**Wiring the availability function.** The generator checks names through
`NEXT_PUBLIC_AVAILABILITY_FN_URL` when it is set, and falls back to direct RDAP calls from the
browser otherwise. Deploy the function with
`supabase functions deploy availability --no-verify-jwt`, set the variable to
`https://<ref>.supabase.co/functions/v1/availability`, and rebuild. The results panel states
which transport is in use; a direct-RDAP build warns that some registries block cross-origin
requests (those show as failed checks, never as available).

**Feature flags.** Every optional capability defaults to off and must stay off for the core
generator to work. Flags are read when a request starts; flipping one changes the next run,
not the current one.

---

## 5. Limits you should know

- No arbitrary JavaScript anywhere in ads or content. Ad slots reference unit IDs; a publisher
  ID must match `ca-pub-<10–20 digits>` at the database level.
- No password resets from this panel — the auth provider owns credentials.
- No image uploads in this iteration; `media` exists in the schema but has no UI yet.
- No live preview of drafts against production data. Drafts are visible only in the admin
  tables; the public build includes published rows.
- Publishing while the build runs produces a snapshot from whenever the build read the
  database. Rebuild after the last edit.
