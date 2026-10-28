# UI/UX upgrade — six-phase report

Scope: audit, fix and upgrade the existing DomainFits platform **without rebuilding it** — same
Next.js static export, same Supabase project, same design system, same admin auth. Every phase was
implemented with real behaviour and tested before the next one started.

Branch: `arena/b181432b-domain`. Verified against commit `6bcfb95` (on top of `34c8bb0`).

---

## Phase 1 — Admin panel

| Requirement | What was built |
| --- | --- |
| Full-height sidebar, consistent icon per item, active highlight | `admin-shell.tsx` renders a `calc(100dvh - var(--site-header-h))` flex shell. Every `ADMIN_NAV` entry has an icon from `nav-icons.tsx`; `tests/admin/nav-icons.test.ts` fails if a route is added without one. Active state uses `aria-current="page"` plus a colour rail, and `activeNavHref()` keeps the list highlighted while that record is open in the full-page editor. |
| Full-width content, independent scrolling | Sidebar and `<main>` are separate `overflow-y-auto` panes in a `min-h-0` flex row; the body never scrolls and `min-w-0` on the content column prevents horizontal overflow. Below `lg` the nav becomes a drawer. |
| Centred modals instead of bottom sheets | `overlay.tsx` `Dialog` is a centred, viewport-clamped panel: overlay, close button, `role="dialog"` + labelled title, focus trap, Escape, focus restore, scroll lock, body scroll area with a fixed footer. Category creation, ad configuration and the small settings forms use it, with inline validation. |
| Dedicated editor, not a popup | `create`/`edit` on `posts` and `pages` route to `/admin/editor/?type=…&slug=…` instead of opening the generic modal. |

## Phase 2 — Dedicated post/page editor

- Route: `src/app/admin/(protected)/editor/page.tsx` (`noindex`, `Suspense` + skeleton, query-string
  driven because a static export has no server to read params).
- Layout: two columns. Left — title (auto-growing textarea), editable permalink with slug
  normalisation, Tiptap body, excerpt, word/character counters, delete. Right — status
  (draft/scheduled/published/archived), publish date, schedule date-time, category (+ create
  category), tags, cover/share image with alt text, author, SEO title, meta description, canonical
  URL, noindex, live search preview, and a note about what publishing to a static site means.
- Toolbar: sticky **inside the editor container** and offset below the sticky action bar
  (`toolbarStickyTop`), so it never covers the title. It offers only marks the sanitiser keeps —
  no alignment control, because `style` attributes are stripped on save (`tests/admin/rich-text-editor.test.ts`).
- Real saving: anon client + RLS, tags upserted into `post_tags`/`post_tags_map`, 301 redirect
  created when a published slug changes, `⌘/Ctrl+S`, `beforeunload` guard, leave-confirmation,
  duplicate-slug check before write, inline field errors.
- Scheduling is real: `promote_scheduled_content()` runs every minute from pg_cron (job 2). Verified
  on the live project with a probe row that moved `scheduled → published` within one minute and was
  then deleted.

## Phase 3 — Generator engine

- One primary root, enforced in the field with a plain explanation when a second is typed; root
  analysis panel (word / abbreviation / coined, meaning, variants, syllables, industries,
  suitability) with manual industry and style override.
- Partner-root length 2/3/4/5, independently togglable, filtering the **partner word's** alphabetic
  length only.
- Six naming styles mapped to strategies (pinned by `tests/generator/naming-styles.test.ts`), with a
  recommendation derived from the analysed root.
- Exact quantities: 100/500/1000 reachable; de-duplication without discarding alternatives; bounded
  loops and attempt caps; when the space is smaller than the request the UI states the number
  produced and which constraint is the ceiling; results are paginated.
- CamelCase display from the real spelling, lower-case labels for checks/domains.

Measured with the shipped engine (`roots: ["pay"]`, budget 8 s for ≥500):

| Case | Asked | Produced | Time |
| --- | --- | --- | --- |
| defaults | 100 | 100 | 42 ms |
| defaults | 1000 | 352 (space exhausted, reasons shown) | 35 ms |
| partner 2+3+4+5 | 1000 | 352 | 35 ms |
| compounds (`maxComponents 3`) | 1000 | 1000 | 236 ms |
| `.com/.io/.dev` | 500 | 500 | 42 ms |

The "defaults" row is the honest case: without compounds the space really is ~350, and the UI says so
instead of padding.

## Phase 4 — Availability audit

- Provider: public RDAP via the `availability` Edge Function (server-side, cached in Postgres), with
  a direct-RDAP fallback and an explicit `unsupported_tld` path when neither is configured.
- Limits: 10 names per request in the function, 25-domain batches client-side, concurrency clamped to
  8, per-request 8 s timeout + abort, soft per-caller rate limit in the isolate.
- Fixes made this phase: `checkMany` no longer retries `rate_limited` (retrying a limiter turns a
  pause into a ban); `run()` returns `{ requested, checked, skipped, cancelled }` so the 200-domain
  per-run cap is stated in the toast instead of silently slicing the list.
- Cache: 6 h for definitive answers, 10 min for inconclusive, transient failures not cached;
  browser-side session cache with expiry decided by the engine.
- Observation store: **adopted**. The edge function appends one `availability_checks` row per
  domain+status per 24 h (never for cached answers, never able to change the response), and migration
  `0011_availability_observations.sql` adds `prune_availability_observations(retain_days = 90)` plus a
  daily pg_cron job. Applied to the live project (job 3). This also makes the admin analytics tile
  real rather than structurally zero.
- Credentials: only the anon key reaches the browser; the service-role key exists solely as an Edge
  Function secret.

## Phase 5 — Landing page

- Hero: real `GET` form into `/generator/?q=…` (works before hydration), inline validation,
  suggestion chips, primary/secondary CTAs.
- Result preview: real `generate()` output produced at build time with a fixed seed, rendered with
  the product's own availability chip, which reads **"Not checked"** because no lookup ran.
- Six-step "how it works", eight shipped-feature cards, recent published posts from Supabase (cover
  image, real category name via embedded join, date, reading time, excerpt, link, empty state),
  six-item FAQ, closing CTA.
- SEO: `generateMetadata` (canonical, OG, Twitter), `WebSite` + `FAQPage` JSON-LD generated from the
  same array rendered on the page; removed a stale `SearchAction` that advertised a blog search that
  does not exist. One `<h1>`, sectioned `<h2>`s, `aspect-[16/9]` media to avoid layout shift.
- `tests/content/landing.test.ts` renders the page and asserts the copy still matches the shipped
  engine (six styles, four partner lengths, three quantities, no availability promises).

## Phase 6 — Verification

Executed on this machine, after a clean `npm ci`:

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run typecheck:functions` | 3/3 clean |
| `npx vitest run` | **894 passed / 42 files**, 0 failed |
| `npm run build` (prebuild + next build + hosting config) | 0 errors; `out/.htaccess`, `out/_headers`, `out/_redirects`, `out/redirects.json` written |
| Bundle (`scripts/audit-bundle.ts`) | 5/5 budgets pass; `/admin/editor/` 1,137 kB raw / 342 kB gz (limits 1,200/360) |
| Dev preview | `/`, `/generator/`, `/blog/`, `/admin/editor/` all 200 on port 3000, no server errors |

Database checks against the live project `bjbbrgjiyoquacoypsia` (all rolled back or cleaned up):

- The four editor payload shapes (published post, scheduled post, draft post, published page) plus a
  redirect row and a tag row insert without violating any constraint.
- `set local role anon` → can read published rows, and an insert is rejected by RLS (42501).
- Admin session (`request.jwt.claim.sub` = the owner) → insert succeeds, proving the editor's write
  path is authorised by policy rather than by UI.
- pg_cron job 2 promoted a scheduled probe row inside one minute; job 3 (prune) is registered.

Not executed here, and therefore **not claimed**:

- Browser-level E2E (no browser in this sandbox): visual layout, scroll independence, focus order and
  console cleanliness were verified by reading markup and by component tests, not by driving a page.
- A production deploy: this environment has no Vercel/Deno CLI and no outbound network beyond the
  package registries.

## Remaining issues

1. **Redeploy the `availability` Edge Function.** The observation-store code is in the repository but
   the deployed version predates it, so history rows are not being written yet (caching is unaffected).
   `supabase functions deploy availability --no-verify-jwt`. Recorded as operator TODO #9.
2. **No live Supabase env in this sandbox.** The dev preview runs from the offline content pack and
   the admin says "Supabase is not configured" instead of pretending to save — correct behaviour, but
   it means the preview here is not the production data path.
3. **Generator volume at default constraints.** With `maxComponents 2` the space for a single root is
   ~350 names. 1,000 requires enabling compounds, more partner lengths or a wider length range; the UI
   explains this, but a product decision on the default may be worth making.
4. **Carried over from the deployment brief:** promote the report-only CSP, decide on sign-ups, set the
   admin password, AdSense + consent, Search Console — unchanged and tracked in `docs/deployment.md §10`.

## Next step

Redeploy the availability function, then run the browser-based regression that this environment cannot
run (layout at 360/768/1280 px, keyboard-only traversal of the editor, and one real availability check)
against the Vercel deployment.
