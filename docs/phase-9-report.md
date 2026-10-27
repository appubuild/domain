# Phase 9 — live Supabase project, and navigation that actually renders

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Project:** `DomainFits`
(`bjbbrgjiyoquacoypsia`, ap-northeast-2)

Two things happened: the schema moved from "files in the repo" to **running in the real
project**, and the `nav_menus`/`nav_items` tables stopped being decoration.

---

## 1. Applied to the live project

Seven migrations had only ever been replayed against PGlite. They are now applied, in order,
to `bjbbrgjiyoquacoypsia`:

| Migration | Result |
| --- | --- |
| `0001_core` | roles, users, settings, audit, flags, jobs |
| `0002_naming` | dictionaries, industries, phrase templates, scoring profiles |
| `0003_domains` | TLD directory, availability providers/checks/cache, workspace tables |
| `0004_content` | pages, sections, media, navigation, SEO templates, blog, AI drafts |
| `0005_monetization` | ads, affiliates, click events, analytics, API keys |
| `0006_policies` | RLS enabled on every table + 80 policies |
| `0007_media_storage` | `media` bucket, storage policies, media constraints |
| `0008_navigation` | menu ordering columns, `(menu_id, href)` key |

Verified afterwards:

```
public tables          44
tables without RLS      0
public policies        80
storage policies        4
media bucket public    true
applied migrations      8
```

**RLS was tested, not assumed.** As `anon`:

- `select` on `pages`, `tlds`, `industries` → 8, 12, 17 rows (public content readable);
- `select` on `audit_logs`, `user_roles`, `ai_drafts`, `api_keys`, `availability_checks`,
  `analytics_events` → 0 rows each;
- `insert into pages` → `new row violates row-level security policy`. Refused, as designed.

### One deliberate deviation

`0007` in the repo contains a *guarded shim* that defines `storage.buckets`/`storage.objects`
if they do not exist, so the migration suite can replay it against PGlite without skipping the
file. On the live project those tables already exist and belong to `supabase_storage_admin`, so
the shim was **not** applied — only the bucket row, the four policies and the `media`
constraints. The repo file remains correct for both targets because every statement in the shim
is `if not exists`.

### How the seed was loaded

`seed.sql` is 1,500 lines / 90 KB. Rather than paste it through a SQL channel, the project's own
`pg_net` extension fetched the file from the repository's raw URL and a `do` block executed it —
the same bytes `supabase db push --include-seed` would run, fetched from the commit that was
just pushed. Transaction control statements are stripped before `execute`, because `EXECUTE`
cannot run `begin`/`commit`.

Result: 8 pages, 17 industries (712 industry terms), 12 TLDs, 346 dictionary terms,
5 menus / 20 links, 6 feature flags, 7 SEO templates, 4 roles. **No blog posts** — the seed
ships none, so `/blog/` is an honest empty state.

---

## 2. The sandbox cannot reach your database

Outbound network from this environment is restricted to package registries and GitHub, so
`https://bjbbrgjiyoquacoypsia.supabase.co` is unreachable *from here*. Consequences, stated
plainly:

- **Builds run in this sandbox fall back to the offline content pack.** `loadSiteContent()`
  catches the failure and returns `source: "defaults"` with a warning — by design, so a
  half-connected deployment can never look like live data. A build on your machine, or in CI,
  will read Postgres.
- **Your browser is not the sandbox.** The admin panel, media uploads, the generator's saved
  state and every client-side read go from *your* browser straight to Supabase, so they work in
  the live preview.
- Everything database-side in this phase was verified through the Supabase API (DDL, queries,
  RLS probes), not through the app.

`loadSiteContent()` also gained a 60-second cache. The root layout, every page and the sitemap
each call it; without the cache an unreachable database added a 4-second timeout to every
dev-server request, and a build made dozens of identical round-trips.

---

## 3. Navigation is now real

`nav_menus` and `nav_items` were seeded from the first day and rendered nowhere: the header and
footer used `PRIMARY_NAV`/`FOOTER_NAV` from `src/lib/config/site.ts`. The phase-8 SEO
diagnostics found this the hard way (it reported three pages as orphans because it was reading a
table that did not drive the page).

Changes:

- `src/lib/content/navigation.ts` — `buildNavigation()` maps rows to the shapes the components
  already take. Rules: an empty table falls back to the code defaults (**never** to an empty
  menu); a menu with no usable items is dropped; ordering is `position`, then `id`, so two
  identical databases export identical HTML; items need a label and a `/path`, `#anchor`,
  `https://` or `mailto:` href.
- `loadSiteContent()` fetches both tables and reports `source`/`reason`; a database with
  content but no menus sets a build warning rather than silently rendering nothing.
- `SiteHeader`/`SiteFooter` take the resolved items/columns as props (defaulting to the
  constants, so they stay usable in isolation); the root layout is now an async server
  component that resolves navigation once, at build time.
- Admin: **Navigation → Menu items / Menus**, with `menu_id` as a reference field.
- Migration `0008` adds `nav_menus.position` and `nav_menus.enabled` (ordering and hiding were
  impossible before) and a unique `(menu_id, href)`.

### The idempotency bug this uncovered

`seed.sql` claimed to be "safe to run repeatedly", and `nav_items` used `on conflict do nothing`
with **no conflict target and no unique key** — so every re-run of the seed duplicated every
link. The new key plus `on conflict (menu_id, href) do update` makes the seed converge instead
of accumulate; the live project was re-seeded twice and stayed at exactly 20 items.

### Seed drift

`seed.sql` is generated, and in phase 8 three SEO fixes were made to the file by hand rather
than to `src/lib/content/defaults.ts`. Nothing failed; the next regeneration would have
reverted them silently. Now:

- the SQL builder lives in `scripts/seed-sql.ts`, imported by both the CLI and the tests;
- nav rows are generated from `PRIMARY_NAV`/`FOOTER_NAV`, so the database and the code
  defaults are the same five menus by construction;
- `tests/db/seed-sync.test.ts` fails if the committed file differs from the generator by one
  byte, and asserts every `insert` has a conflict strategy.

---

## 4. Verification

```
tsc --noEmit      exit 0
vitest run        391 passed / 22 files   (was 365)
npm run build     ✓ 63/63 pages, ✓ Exporting (2/2)
dev server        / /about/ /admin/nav-items/ /admin/seo/ /admin/media/ → 200 (≤0.5 s)
```

New tests: `tests/content/navigation.test.ts` (12) for the mapping rules,
`tests/db/nav-seed.test.ts` (6) which loads migrations **and seed** into PGlite, reads the rows
back and asserts the rendered navigation matches the configuration — including that re-running
the seed leaves 20 links, and that disabling a menu hides its column. `tests/db/seed-sync.test.ts`
(6) guards the generator. `tests/admin/registry-shape.test.ts` gained the rule that every
reference field must declare itself `nullable` or `required` (my first version wrongly demanded
nullable everywhere, which would have banned the entirely correct `nav_items.menu_id`).

Two test failures during development were my own: the fetch mock in `content.test.ts` did not
include the new nav tables, and the registry rule was too strict. Both are now part of the suite.

## 5. What you still need to do (once)

1. **Create your admin account**: open `/admin/login/`, sign up, confirm the email Supabase
   sends. Then grant the role:

   ```sql
   insert into public.user_roles (user_id, role_id)
   select id, 'owner' from auth.users where email = 'you@example.com'
   on conflict do nothing;
   ```

   Tell me the address and I will run it. After that, consider disabling sign-ups
   (Authentication → Providers → Email) so the only accounts are ones you create.
2. **Set `NEXT_PUBLIC_APP_URL`** to the production origin before the deploy build — without it
   the export omits `sitemap.xml`, canonical links and Open Graph URLs (the build logs a
   warning; the SEO screen shows it too).
3. **Deploy the Edge Functions** if you want availability checks or the AI studio; each needs
   its own secret and none of them are configured yet.

## 6. Next

1. A media picker inside the post/page editor (the outstanding gap from phase 7).
2. Availability provider wiring against a real provider, now that the project exists.
3. Playwright suite for the critical journeys.
