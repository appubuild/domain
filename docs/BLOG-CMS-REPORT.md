# Final CMS, SEO & Content Upgrade — Delivery Report

Branch `arena/5072ed86-domain` · PR #3 · commits `114bd8b → 897d5d5 → b8843ed`

---

## 1. What changed, in one paragraph

The site gained a real content operation. There is now a database schema and API
for pages, posts, categories, tags, media and scheduled publishing; an admin
console with rich-text editing, SEO fields, media picking and a publishing
queue; public blog pages for the archive, the article and the category archive;
and an editorial library of **30 homeowner guides** (25,336 words) with **30
purpose-drawn SVG illustrations**, all shipped through two reproducible
generators. It works with the API connected and, on a build without
`VITE_API_BASE_URL`, it still shows ten sample articles instead of an empty page.

---

## 2. Editorial library

| Metric | Value |
| --- | --- |
| Articles | 30 |
| Body words | 25,336 (avg 845, range 720–1,283) |
| Categories | 15 (= the 14 service verticals + “Hiring a Pro”) |
| Tags | 64 |
| FAQs | 111 (3–4 per article) |
| Internal links | 30 article→article, 30 article→service |
| Illustrations | 30 SVG, 126 kB total, avg 4.2 kB |

Every article carries a primary keyword, 4–7 secondary keywords, search intent,
audience, CTA target, image + alt text, SEO title (≤ 60 chars), meta description
(140–160 chars), excerpt, editorial summary, tags, art direction, structured body
sections and FAQs.

Publishing schedule produced by the import: ids 1–10 published at 09:00 ET across
the previous 14 days, ids 11–30 scheduled one per day at 09:00 ET, stored in UTC.

---

## 3. Database and API

**Migration** `api/database/migrations/2026-11-blog-cms-upgrade.sql`

* `blog_posts` + `seo_summary`, `focus_keyword`, `secondary_keywords`,
  `canonical_url`, `noindex`, `social_image`, `view_count`, `scheduled_at`,
  `updated_by`.
* `blog_categories` + `seo_title`, `seo_description`, `sort_order`, `noindex`.
* `pages` + `focus_keyword`, `secondary_keywords`, `canonical_url`, `noindex`,
  `og_image`, `page_group`, `sort_order`, `scheduled_at`.
* `media` + `kind`, `description`.
* New `blog_post_metadata` and `publishing_log` tables.

**Endpoints** (135 routes total, 235 dependency calls verified):

```
GET|POST      /v1/admin/blog              GET|PUT|DELETE /v1/admin/blog/{id}
POST          /v1/admin/blog/{id}/publish · /unpublish
GET|POST      /v1/admin/blog/categories   PUT|DELETE /v1/admin/blog/categories/{id}
GET|POST      /v1/admin/blog/tags         DELETE /v1/admin/blog/tags/{id}
GET|POST      /v1/admin/pages             GET|PUT|DELETE /v1/admin/pages/{id}
GET|POST      /v1/admin/media
GET|POST      /v1/admin/publishing/run · /log · /sitemap
GET           /v1/blog · /v1/blog/{slug} · /v1/blog/categories[/{slug}]
GET           /v1/sitemap · /v1/sitemap.xml
```

**Public visibility rule** (single source of truth in `BlogModel`):

```sql
status = 'published'
OR (status = 'scheduled' AND scheduled_at <= UTC_TIMESTAMP())
```

---

## 4. Admin console

New screens: `BlogEditorPage`, `PageEditorPage`, `CategoriesPage`,
`PublishingPage`; `BlogPage`/`PagesPage` became filterable lists. The editor is
TipTap 2.11 (headings, lists, links, tables, images, alignment, character count)
behind a `forwardRef` handle, with a `MediaPicker`, SEO panel, scheduling control
and a live word count. Scheduling converts `America/New_York` local time to UTC
and back; publish/unpublish are guarded updates that check `rowCount() === 1`.
Demo mode (no API) keeps the same screens against `localStorage` and now uses the
same 15 categories as production.

---

## 5. Public blog and SEO

* `/blog` — archive with search, category filter chips (with counts), pagination,
  skeletons, empty and error states.
* `/blog/:slug` — article with breadcrumbs, hero, table of contents generated
  from the H2/H3 headings, prose styling, FAQ block, related guides and a CTA
  band; the phone block only renders when the category maps to a real service.
* `/blog/category/:slug` — category archive with its own hero, JSON-LD
  `CollectionPage` and breadcrumbs.
* `useSeo` drives title, description, canonical path, Open Graph image and JSON-LD
  (`Article` + `BreadcrumbList`) per page.
* Navigation: “Blog” in the header (desktop + mobile) and “Homeowner guides” in the
  footer.
* `sitemap.xml` now lists `/blog` and all 15 category archives; the runtime
  builder adds published posts hourly and after every publish.

---

## 6. Illustrations

`scripts/generate-blog-images.mjs` draws one scene per article from a shared
composition: paper background with dot texture, white medallion holding a hero
icon drawn on a 100×100 grid, two or three icon chips, a homeowner on the floor
line, and the site badge. 29 hand-built icons and 17 chip glyphs cover every
category. Output is self-contained SVG (no fonts, rasters or external refs),
3–6 kB each, verified by the content test suite.

---

## 7. Content pipeline

```
api/database/content/articles/*.json      editorial source (one file per category)
        │
        ├── scripts/generate-blog-import.mjs  → api/database/blog-content-import.sql
        │                                        (15 categories, 64 tags, 30 posts,
        │                                         120 tag links, 180 metadata rows,
        │                                         30 media rows, verification SELECT)
        ├── scripts/generate-blog-demo.mjs    → src/lib/api/blogDemoData.ts
        │                                        (10 posts, lazy-loaded chunk)
        └── scripts/generate-blog-images.mjs  → public/images/blog/*.svg
```

`npm run blog:content` and `npm run blog:images` run them. Both import generators
share `scripts/lib/render-article.mjs`, so the SQL body, the demo body and the
rendered page are byte-identical. The demo generator prunes links to articles a
demo build cannot serve, so no sample page links to a 404.

---

## 8. Demo mode

Builds without `VITE_API_BASE_URL` (the default `npm run build`) fall back to the
bundled sample articles: `fetchPosts`, `fetchPost`, `fetchCategories` and
`fetchCategory` all serve demo data, so `/blog`, `/blog/:slug` and
`/blog/category/:slug` are browsable with no backend. A “Sample content” note
sits above the archive. The demo chunk is code-split (116 kB / 31 kB gzip) and is
never downloaded by production visitors.

---

## 9. Quality gates

| Suite | Result |
| --- | --- |
| `npm run test:directory` | 28 passed, 0 failed |
| `npm run test:admin` | 83 passed, 0 failed |
| `npm run test:content` (new) | 16 passed, 0 failed |
| `npm run test:api` | 33 passed, 0 failed |
| `tsc --noEmit -p tsconfig.app.json` | 0 errors |
| `npm run build` | success |
| `api/tests/route-check.php` | 135 routes / 235 dependency calls |

`test:content` guards the pipeline: 30 unique ids/slugs, required fields, SEO
length limits, CTA targets resolving to real services, internal links resolving,
15 consistent categories, every referenced SVG present and none orphaned, SVG
self-containment, demo parity with the editorial source, no demo link to an
unpublished post, heading-id and date helpers, and sitemap coverage.

Build output: `index.js` 471.7 kB (137.1 kB gzip), `AdminApp.js` 660.0 kB
(192.0 kB gzip), `blogDemoData.js` 115.8 kB (30.7 kB gzip), CSS 76.7 kB
(13.1 kB gzip).

---

## 10. Deployment steps and known limits

**To go live**

1. `mysql … < api/database/migrations/2026-11-blog-cms-upgrade.sql`
2. `mysql … < api/database/blog-content-import.sql` — the final `SELECT` should
   report 10 published, 20 scheduled, 15 categories, 64 tags, 180 metadata rows.
3. Cron: `publish-scheduled.php` every 5 minutes, `build-sitemap.php` hourly
   (see [PUBLISHING.md](PUBLISHING.md)).
4. Build with `VITE_API_BASE_URL=https://your-domain/api` and upload `dist/`,
   `public/images/blog/` and the API.

**Known limits**

* Illustrations are flat 2D vector scenes by design — no photography, no people
  in realistic detail. They render identically everywhere and weigh ~4 kB.
* Demo mode shows the ten earliest articles only; the other twenty appear once
  the API is connected and the scheduler has run.
* The admin console chunk (660 kB) is lazily loaded; further splitting of the
  TipTap editor is possible if the console's first paint matters.
* Search Console keyword and caller-state tables stay empty by design — they are
  not estimated.
* Article length is 720–1,283 words; anything longer should be a deliberate
  editorial choice rather than a target.
