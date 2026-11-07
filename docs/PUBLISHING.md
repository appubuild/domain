# Publishing & Editorial Content

How articles get written, imported, scheduled, published and indexed — and how to
keep the public blog, the admin console and the sitemap in agreement.

---

## 1. The three layers

| Layer | Lives in | Owns |
| --- | --- | --- |
| Editorial source | `api/database/content/articles/*.json` | Titles, slugs, SEO fields, body sections, FAQs, image paths |
| Generated artefacts | `api/database/blog-content-import.sql`, `public/images/blog/*.svg` | The MySQL import and the 30 illustrations |
| Runtime | MySQL + `api/cron/*` | Live posts, scheduled publishing, sitemap |

Nothing in the database is hand-edited during normal work: change the JSON, run
the two generators, import the SQL. The generators are deterministic, so a
regenerated file diffs only where the editorial content changed.

---

## 2. Writing an article

One JSON file per category, an array of articles, sorted and merged by `id`:

```
api/database/content/articles/
  appliance-repair.json      ids 1–3
  electrical.json            ids 4–6
  plumbing.json              ids 7–8
  hvac.json                  ids 9–10
  roofing.json               ids 11–12
  roof-repair.json           ids 13–14
  water-damage.json          ids 15–16
  pest-control.json          ids 17–18
  kitchen-remodeling.json    ids 19–20
  bathroom-remodeling.json   ids 21–22
  window-installation.json   ids 23–24
  door-installation.json     id  25
  concrete-paving.json       ids 26–27
  locksmith.json             id  28
  hiring-a-pro.json          ids 29–30
```

`id` is the editorial order and therefore the **publishing order**: the first
ten are published on import, the rest are scheduled one per day. Keep ids
stable once an article has shipped.

### Article shape

```jsonc
{
  "id": 7,
  "title": "Headline shown on the page",
  "slug": "url-slug-under-blog",
  "category": { "slug": "...", "name": "...", "description": "...",
                "seoTitle": "...", "seoDescription": "...", "sortOrder": 3 },
  "primaryKeyword": "…",
  "secondaryKeywords": ["…"],
  "intent": "Informational | Commercial investigation",
  "audience": "One sentence describing the reader",
  "cta": { "label": "…", "href": "/services/…" },
  "internalLinks": [{ "label": "…", "href": "/blog/…" }],
  "image": "/images/blog/<slug>.svg",
  "imageAlt": "…",
  "seoTitle": "≤ 60 characters",
  "seoDescription": "140–160 characters",
  "excerpt": "Used on cards, in the archive and as the meta fallback",
  "seoSummary": "Internal editorial note + media description",
  "author": "Safe Home Network Editorial",
  "tags": ["…"],
  "visual": "Art direction for the illustration",
  "sections": [],
  "faqs": [{ "q": "…", "a": "…" }]
}
```

### Section blocks

A section is an object with any combination of:

| Key | Renders as |
| --- | --- |
| `h2` | `<h2>` |
| `h3` | `<h3>` |
| `paras: []` | `<p>` per entry |
| `bullets: []` | `<ul>` |
| `ordered: []` | `<ol>` |
| `table: { head, rows }` | `<figure class="article-table"><table>` |
| `note` | `<blockquote>` |

Inline `**bold**`, `*italic*` and `` `code` `` are converted. HTML is escaped
first, so the JSON can contain `<` and `&` safely. Every article gets a
generated FAQ block, a "Where to go next" link list and a short disclaimer
appended automatically.

---

## 3. Generating the import

```bash
node scripts/generate-blog-import.mjs
```

Output: `api/database/blog-content-import.sql` — generated, never edited by
hand. It contains:

1. **15 categories** — `ON DUPLICATE KEY UPDATE` on `slug`.
2. **Tags** — derived from the `tags` arrays, de-duplicated and slugified.
3. **30 posts** — `INSERT … SELECT … FROM blog_categories` so the category id is
   resolved by slug; `ON DUPLICATE KEY UPDATE` on `slug` makes re-runs safe.
4. **Tag links** — delete-then-insert per post, so re-runs never duplicate.
5. **`blog_post_metadata`** — search intent, audience, word count, CTA target,
   internal links and visual direction, one row per key.
6. **Media rows** — one per illustration, `WHERE NOT EXISTS` on path, so the
   admin media library lists the SVGs without allowing SVG uploads.
7. **A verification `SELECT`** — published count, scheduled count, categories,
   tags, metadata rows.

Current output:

```
blog import written: 30 articles, 10 published, 20 scheduled,
64 tags, 15 categories, 27256 words
```

### Publishing schedule produced by the generator

| Articles | Status | Timestamp |
| --- | --- | --- |
| ids 1–10 | `published` | 09:00 America/New_York, spread over the 14 days before the run |
| ids 11–30 | `scheduled` | 09:00 America/New_York, one per day starting the day after the run |

Local time is converted to UTC with `Intl` for the target date, so a run in
summer writes `13:00:00Z` and a run in winter `14:00:00Z` — always 09:00 local.

### Importing

```bash
mysql -u USER -p DATABASE < api/database/migrations/2026-11-blog-cms-upgrade.sql
mysql -u USER -p DATABASE < api/database/blog-content-import.sql
```

Run the migration first: the import relies on `scheduled_at`, `seo_summary`,
`focus_keyword`, `secondary_keywords`, `blog_post_metadata` and `media.kind`.

### If the import fails with `#1054 Unknown column …`

That error means the columns the import writes do not exist yet — the migration
did not run. The most common reason is that the host's phpMyAdmin does not
understand the `DELIMITER` directive the migration uses for its helper
procedures; the file then stops on its first statement and applies nothing.

1. Check what is missing (an empty result means you are ready to import):

   ```bash
   mysql -u USER -p DATABASE < api/database/check-cms-schema.sql
   ```

2. Apply the DELIMITER-free edition of the same migration — plain `ALTER`
   statements guarded by `information_schema` checks, so it is safe to run any
   number of times and never raises `#1060 Duplicate column`:

   ```bash
   mysql -u USER -p DATABASE < api/database/migrations/2026-11-blog-cms-upgrade-idempotent.sql
   ```

   In phpMyAdmin: select the database → **SQL** tab → paste the file → **Go**.
   It finishes with a verification row: `blog cms migration applied | 1 | 1 | 2`.

3. Re-run the import. Other errors you may meet:

   | Error | Meaning | Fix |
   | --- | --- | --- |
   | `#1054 Unknown column 'x'` | migration not applied | step 2 above |
   | `#1060 Duplicate column` | part of it already ran | use the idempotent file |
   | `#1146 Table 'x' doesn't exist` | base schema missing | import `schema.sql` first |
   | `#1452 Cannot add or update a child row` | the category row it needs is missing | run the file again; categories are inserted before posts |

The generated migration (`2026-11-blog-cms-upgrade-idempotent.sql`) is rebuilt
from the hand-written one with
`node scripts/generate-migration-idempotent.mjs`, so the two never drift.

---

## 4. Illustrations

```bash
node scripts/generate-blog-images.mjs
```

Thirty SVG scenes, one per article, all built from the same composition: paper
background with a dot texture, a white medallion holding a hero icon drawn on a
100 × 100 grid, two or three icon chips, a homeowner on the floor line and the
site badge. Palette comes from the site tokens (deep navy, teal, warm sand,
amber), so the set reads as one family.

* Files: `public/images/blog/<slug>.svg`, named after the article slug.
* No fonts are embedded except the badge, which uses a system stack.
* No external references, no raster data — each file is 3–6 kB.
* The generator checks every `image` path in the JSON and prints `MISSING` or
  `UNUSED` entries, so a renamed slug cannot silently break a card.

To add an article: add a scene entry with `file`, `title`, `desc`, `bg`,
`accent`, `hero` and `satellites`, then run the generator. Available heroes and
chips are listed in the `icons` and `chips` objects at the top of the script.

---

## 5. Scheduling and automatic publishing

| Piece | Path | Purpose |
| --- | --- | --- |
| Scheduler service | `api/services/Scheduler.php` | Publishes due posts, writes `publishing_log`, rebuilds the sitemap |
| Cron entry point | `api/cron/publish-scheduled.php` | CLI only (HTTP returns 403), takes a lock file |
| Sitemap entry point | `api/cron/build-sitemap.php` | Regenerates `public/sitemap.xml` from the database |
| Admin trigger | `POST /v1/admin/publishing/run` | Manual "publish now" from the console |

```cron
*/5 * * * * /usr/local/bin/php /home/USER/public_html/api/cron/publish-scheduled.php >> /home/USER/logs/cron.log 2>&1
0 * * * *   /usr/local/bin/php /home/USER/public_html/api/cron/build-sitemap.php   >> /home/USER/logs/cron.log 2>&1
```

Flags: `--dry-run` reports what would publish, `--actor=NAME` records who
triggered it, `--quiet` suppresses output. The lock file lives at
`api/storage/logs/publish-scheduled.lock` and prevents overlapping runs.

### Public visibility rule

A post is public when:

```sql
status = 'published'
OR (status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP())
```

Drafts, `noindex` rows and scheduled posts whose time has not arrived are never
returned by the public blog endpoints and never enter the sitemap.

### Time zones

`scheduled_at` is stored in UTC. The admin editor shows and accepts local time in
`America/New_York` and converts with `contentApi.localInputToUtc` /
`utcToLocalInput`. The list view formats with `formatUtc`, so a post scheduled
for 09:00 shows as 09:00 ET regardless of the browser's zone.

---

## 6. Sitemap

Two sources, one file:

* `scripts/generate-sitemap.mjs` writes `public/sitemap.xml` at build time
  (wired to `prebuild`): static routes, the 15 service pages, `/blog` and the 15
  blog category archives.
* `api/services/SitemapBuilder.php` regenerates the same file from the database
  hourly, adding published posts and any pages created in the admin console.

The runtime version wins in production because it runs last, and it is
regenerated immediately whenever the scheduler publishes something.

---

## 7. Pre-flight checklist for a new article

- [ ] `slug` is unique, lowercase, hyphenated, and matches the image filename.
- [ ] `seoTitle` ≤ 60 characters, `seoDescription` 140–160 characters.
- [ ] `image` and `imageAlt` set; the file exists in `public/images/blog/`.
- [ ] Every `/blog/...` internal link points at a slug that exists.
- [ ] `cta.href` points at a real `/services/...` page (or `/services`).
- [ ] At least one `table`, `note` or `ordered` block for scannability.
- [ ] Three or four FAQs answering questions the article does not already answer.
- [ ] `node scripts/generate-blog-import.mjs` runs clean (no `NOTE:` warning).
- [ ] `node scripts/generate-blog-images.mjs` prints no `MISSING` / `UNUSED`.
- [ ] `npm run test` and `npm run build` pass.
