# Phase 12 — Analytics & intelligence, and a view that was leaking

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain` · **Live:** <https://domainfits.vercel.app>

The schema has had an `analytics_events` table since migration `0005`, an admin screen since
phase 6, and a `trackEvent()` helper with careful comments about honesty. What it did not have
was **most of the events**. Four of the eleven event types in the schema's own `CHECK`
constraint were emitted by nothing at all — including `page_view`, the one a new operator looks
at first.

This phase fixes the instrumentation, moves the aggregation into the database so the numbers are
exact instead of a labelled sample, and closes a policy hole found along the way.

---

## 1. The instrumentation gap

| Event | Emitted before | Now |
| --- | --- | --- |
| `page_view` | **never** | root layout, one row per public page load; skips `/admin`, honours Do Not Track |
| `filter_applied` | **never** | generator, debounced 900 ms so a slider drag is one event, not forty |
| `login` | **never** | admin sign-in, on success only |
| `ai_generation` | **never** | AI studio, when a draft is actually created |
| `generation_run` | yes | unchanged |
| `availability_check` / `availability_failure` | yes | unchanged |
| `export_created`, `favorite_added` | yes | unchanged |
| `affiliate_click` | no — and correctly so | clicks live in `click_events`; the report reads that table directly rather than double-writing |
| `signup` | no | still honest: there is no public sign-up screen, and the dashboard says so |

The vocabulary is now a value (`EVENT_TYPES`) rather than only a type, and `EVENT_CATALOG` maps
every entry to what emits it. A test fails if the two lists diverge, and another fails if an
entry with no producer lacks a written reason. That is what would have caught the four missing
events years earlier.

---

## 2. Aggregation moved into Postgres

The old screen fetched up to 5,000 raw rows and grouped them in JavaScript. On a busy window the
totals were therefore a **sample**, and the page had to print a truncation warning — technically
honest, practically useless.

`0009_analytics_reporting.sql` adds five read-only, `security invoker` functions:

| Function | Returns |
| --- | --- |
| `analytics_event_totals(p_since)` | event type → count |
| `analytics_daily_totals(p_since date)` | UTC day → count |
| `analytics_path_totals(p_since, p_limit)` | path → count, limit clamped to 50 |
| `analytics_root_totals(p_since, p_limit)` | keyword from `payload.roots`, unnested |
| `analytics_activity(p_since)` | events, distinct session ids, newest timestamp |

The browser now receives a few dozen rows and every headline number is a true total. The
truncation warning is gone because the condition it described no longer exists.

---

## 3. The leak: `analytics_daily` was readable with the anon key

Worth stating precisely, because it is a class of bug rather than a typo.

A PostgreSQL view runs with its **owner's** privileges unless it is created `security_invoker`.
`analytics_daily` (migration `0005`) was owned by `postgres`, so the aggregate inside it read
`analytics_events` without passing the admin-only RLS policy on that table. Holding the public
anon key was enough to read it.

What it exposed was small — counts per day and event type, no paths, payloads, session hashes or
personal data — and the impact is limited accordingly. It was still a read the policies existed
to refuse, and it was found by asking "does this *view* obey the rule?" rather than "does this
*table* obey the rule?".

Closed in three independent ways:

```sql
alter view public.analytics_daily set (security_invoker = true);  -- RLS now applies
revoke all on public.analytics_daily from anon;                   -- no grant at all
grant select on public.analytics_daily to authenticated;
```

The new functions got the same treatment, with one subtlety that is easy to miss:

```sql
revoke execute on function … from public;  -- ← this line, not just "from anon"
revoke execute on function … from anon;
grant  execute on function … to authenticated;
```

PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function. Revoking only from `anon` would
have left the anon role holding the privilege *through* `PUBLIC`. `tests/db/analytics-reporting.test.ts`
asserts both, so a future migration that recreates a function without its grants fails the
suite.

### Applied to the live project, and verified there

Migration `0009` was executed against `bjbbrgjiyoquacoypsia`, then checked by querying the
catalog rather than trusting the `ALTER`'s success:

```
analytics_daily.reloptions          {security_invoker=true}
has_table_privilege(anon, SELECT)   false
has_table_privilege(auth, SELECT)   true
5 reporting functions               prosecdef = false, anon EXECUTE = false, auth EXECUTE = true
```

This is a permission **tightening**, not a data change: no rows were written or removed, and the
tables the site reads at build time are untouched.

---

## 4. The screen

`/admin/analytics/` was rewritten around the new totals:

- **Headline tiles** — events, distinct session ids (labelled "not people"), registrar clicks
  (`—` when the count could not be read), newest event plus the mean per day.
- **Daily series** — one bar per UTC day, zero bars included, with the same data exposed to
  screen readers as a table. Peak day named in words.
- **Funnel** — generation → availability check → registrar click, with the denominator printed
  and rates suppressed below 25 generations. The note says plainly that this is aggregate, not a
  per-visitor path.
- **Events by type**, **top paths**, and **keywords people generate from** — the last one
  unnests `payload.roots`, so the generator's own vocabulary becomes visible.
- **Instrumentation table** — every event type, what emits it, its count in the window, and one
  of three badges: `counting`, `wired · zero in range`, `no producer`.

The loader distinguishes three outcomes rather than collapsing them: `not-configured`,
`unavailable` (naming the missing migration when that is the cause), and `supabase`. An empty
window says it is empty instead of drawing a flat line.

---

## 5. Verification

```
tsc --noEmit        clean
vitest run          456 tests / 26 files        (was 429 / 24)
npm run build       exit 0, ✓ Exporting (2/2)
```

New: `tests/analytics/report.test.ts` (17 — zero-filling, funnel suppression, catalogue
completeness), `tests/db/analytics-reporting.test.ts` (10 against real PostgreSQL — function
existence, `security_invoker`, anon refusal including via `PUBLIC`, admin totals, keyword
unnesting, limit clamping, sessions), plus four consumers added in the generator, layout, login
and studio.

---

## 6. Still not true, and not claimed

- **`signup` has no producer** because there is no public sign-up screen. The dashboard labels it
  `no producer` rather than showing a misleading zero.
- **Sessions ≠ people.** The hash is a random per-tab id; two tabs are two sessions, and a
  returning visitor is a new session tomorrow. The UI says so next to the number.
- **No retention, cohort or attribution analysis.** Those need per-visitor identity, which this
  product deliberately does not collect.
- **The Edge Function still does not record `availability_failure` server-side.** The client
  does; a function-side counter needs the function deployed.

## 7. Postscript: the homepage was still advertising the scaffold

Not analytics, but found while checking the deploy: `/` still wore a **"Phase 1 · Foundation"**
badge and a card explaining that the generator, brain and admin modules would be built "in the
next phases". Every one of those existed. A visitor's first impression was that the site was a
placeholder, which is a worse failure than a missing feature — the honesty rule cuts both ways,
and understating what works is still a false statement.

Replaced with an eyebrow that describes the product and a card listing what the generator does.
Every claim on it is checked against the code: CSV/TXT/JSON exist in `src/lib/export/exporters.ts`
(*not* the Markdown and sharing I first drafted), availability carries provider and timestamp,
and score factors carry weights. Deployment `dpl_GS9JsEL7JjkQSpFLWSCjTAzjLR3Q` verified live.

## 8. Files touched

```
supabase/migrations/0009_analytics_reporting.sql   # new: 5 functions + the view fix
src/lib/analytics/events.ts                        # EVENT_TYPES as a value
src/lib/analytics/report.ts                        # new: arithmetic, funnel, coverage catalogue
src/lib/analytics/client.ts                        # new: RPC loader with three honest outcomes
src/components/analytics/page-view-counter.tsx     # new: public page counter
src/app/admin/(protected)/analytics/page.tsx       # rewritten
src/app/layout.tsx                                 # mounts the counter
src/app/admin/login/page.tsx                       # login event
src/app/admin/(protected)/studio/page.tsx          # ai_generation event
src/components/generator/generator-workspace.tsx   # debounced filter_applied
tests/analytics/report.test.ts                     # new
tests/db/analytics-reporting.test.ts               # new
docs/security.md                                   # the view-bypasses-RLS section
docs/admin-guide.md                                # how to read the analytics screen
src/app/page.tsx                                   # postscript: the stale Phase 1 hero
```
