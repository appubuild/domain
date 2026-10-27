# Phase 8 — SEO diagnostics

**Date:** 2026-10-27 · **Branch:** `arena/b181432b-domain`

A screen at `/admin/seo/` that reads the real rows and reports what is demonstrably wrong with
them. No score, no health percentage, no recommendations — findings with a rule, a row and a fix.

---

## 1. What was built

| Piece | File |
| --- | --- |
| Rule engine (pure, 57 tests) | `src/lib/seo/diagnostics.ts` |
| Admin screen | `src/app/admin/(protected)/seo/page.tsx` |
| Seed-content regression guard | `tests/seo/seed-content.test.ts` |

Findings carry a stable `id`, a severity (`error` / `warning` / `notice`), the subject row, the
public path it affects, the admin screen that fixes it, and two sentences: what is wrong and
what to do. The severity definitions are on the screen so nobody has to guess:

- **error** — broken for visitors or search engines;
- **warning** — works, but loses traffic, clarity or accessibility;
- **notice** — worth knowing, sometimes intentional.

---

## 2. There is no score, deliberately

A number out of 100 would imply a ranking model this application does not have and cannot
verify. It would also be trivially gameable and would make the screen feel authoritative while
measuring nothing. What the screen offers instead:

- counts that are literally `findings.filter(...).length`, so "3 errors" always expands to a
  list of three items you can read;
- "Scanned: 8 pages · 0 posts · 2 redirects" next to the findings, so 0 errors on 0 rows cannot
  be misread as a clean bill of health;
- an explicit list of what is **not** checked — backlinks, rankings, competitor comparison,
  Core Web Vitals from real users, click-through — because none of those can be derived from
  the content tables;
- partial-failure honesty: if any query fails, the screen names the source and says those rules
  did not run, rather than showing a smaller report that looks clean.

---

## 3. Rules

**Indexability**
| Code | Severity | Condition |
| --- | --- | --- |
| `published-without-date` | error | status published, no `published_at` — the site never renders it and the sitemap omits it |
| `future-publish-date` | notice | date in the future |
| `scheduled-content` | notice | status scheduled — a static export does not pick it up on its own |

**Titles, descriptions, substance**
| Code | Severity | Condition |
| --- | --- | --- |
| `missing-title` | error | no title and no SEO title |
| `title-too-long` / `title-too-short` | warning / notice | outside 20–70 characters (measure the *effective* title, SEO title first) |
| `missing-description` | warning | no meta description and no excerpt |
| `description-too-long` / `-short` | notice | outside 70–160 characters |
| `thin-content` | warning | under 300 characters of text, measured with markup stripped |
| `duplicate-title` / `duplicate-description` | warning | the same value on two or more indexable rows |

**Routes, canonicals, images**
| Code | Severity | Condition |
| --- | --- | --- |
| `reserved-slug` | error | a page slug that collides with a real route (`/generator/`, `/blog/`, …) |
| `canonical-self` | notice | canonical points at the page's own URL |
| `canonical-relative` | warning | relative canonical (works, but ambiguous) |
| `cover-image-without-alt` | error | a cover image with no alt text — the same rule the media library enforces at upload |

**Redirects** — loops (error), chains (warning, names the final destination), targets that match
nothing (error), sources that shadow a live page (error), 302/307 (notice: search engines keep
the old URL indexed). Disabled redirects are ignored entirely; external targets are not checked,
because doing so would require fetching the internet.

**Links and navigation** — internal `href`s in bodies that resolve to nothing (error), and menu
entries that resolve to nothing (error). A link to a redirect source counts as working, because
for a visitor it is.

**Orphans** — a published, indexable page with no inbound link from the menu or from any other
page or post. Posts are exempt: `/blog/` lists them.

---

## 4. The bug this phase found in itself

The first version passed only `nav_items` rows as the site's navigation. Running the engine over
the real seed reported `/about/`, `/contact/` and `/faq/` as orphans.

They are not orphans. The header and footer render `PRIMARY_NAV` and `FOOTER_NAV` from
`src/lib/config/site.ts` — **static TypeScript, not the database** — and all three are linked in
the footer's Company column. The diagnostics were right about the data and wrong about the
world: they were checking a table that does not drive the page.

Two consequences, both handled:

1. The admin screen now merges the rendered menus from `site.ts` with whatever is in
   `nav_items`, and the seed test does the same. False orphan reports are gone.
2. A real inconsistency was documented rather than hidden: **`nav_items` existed, was seeded,
   and nothing rendered it.** Editing it changed no pixel. That was fixed in phase 9 — the
   header and footer now read `nav_menus`/`nav_items` at build time, with the code constants as
   the fallback. See [`phase-9-report.md`](phase-9-report.md).

The seed content itself was also cleaned up by the engine: three notices (two short SEO titles,
one 169-character description) were fixed in `seed.sql`, so the shipped content now produces
**zero findings of any severity**.

---

## 5. Verification

```
tsc --noEmit      exit 0
vitest run        365 passed / 19 files   (was 308)
npm run build     ✓ 63/63 pages, ✓ Exporting (2/2), /admin/seo emitted
dev server        /admin/seo/ /admin/media/ /admin/ /about/ /faq/ /blog/  → 200
```

`tests/seo/seed-content.test.ts` replays every migration into PGlite, loads `seed.sql`, and runs
the engine over the result. It **fails the build on any error**, and prints warnings and notices
to the test log so editorial debt stays visible instead of silent. That is the difference between
a linter and a linter that runs.

Three of the rules were wrong on first write and were corrected by their own tests: the fixtures
shared an excerpt (correctly tripping the duplicate rule), one test asserted a severity ordering
that its fixture could never produce, and `pages` has no `cover_image_url` column — only posts
do. All three were test or fixture mistakes, not engine bugs, which is the right ratio.

## 6. Limitations

- **No crawling.** External links, redirects to other domains and anything requiring a live HTTP
  request are out of scope; the checks are structural only.
- **No historical view.** The screen shows the current state; there is no trend, no "fixed since
  last run". Nothing is stored — findings are recomputed on every load.
- **`nav_items` was not rendered when this phase shipped.** Superseded by phase 9.
- **No per-page drill-down.** A finding links to the module and to the public path, not to the
  specific row's editor drawer (the CRUD manager opens by query string, which is not wired yet).
- **The seed ships no blog posts**, so `/blog/` is empty on a fresh install. That is an honest
  empty state rather than filler, but it means the diagnostics cannot exercise post-specific
  rules against seed data.

## 7. Next

1. Wire `nav_items` into the build so navigation is actually editable (and delete the ambiguity).
2. A media picker inside the post/page editor — still the outstanding gap from phase 7.
3. Playwright suite for the critical journeys once a browser is available.
