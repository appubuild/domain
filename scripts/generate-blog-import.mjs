/**
 * Builds api/database/blog-content-import.sql from content/articles/*.json.
 *
 *   node scripts/generate-blog-import.mjs
 *
 * Why a generator: the editorial source is JSON (title, keyword map, outline,
 * FAQ, body sections), and the SQL must stay byte-identical every time it is
 * regenerated so the import is reproducible. The generated file:
 *
 *   · creates/updates the 15 blog categories (slug is unique)
 *   · creates/updates the tags
 *   · inserts the 30 posts with their SEO fields and metadata
 *   · links posts to categories and tags
 *   · publishes the first 10 (past dates) and schedules the remaining 20 one
 *     per day at 09:00 America/New_York, stored as UTC
 *
 * Publishing times: 09:00 ET = 14:00 UTC under EST (UTC-5) and 13:00 UTC under
 * EDT (UTC-4). The offset is computed with Intl for the target date, so a run in
 * summer produces 13:00Z and a run in winter 14:00Z — always 09:00 local.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderBody, wordCount } from './lib/render-article.mjs'

const root = process.cwd()
const sourceDir = resolve(root, 'api/database/content/articles')
const outPath = resolve(root, 'api/database/blog-content-import.sql')

const TIMEZONE = 'America/New_York'
const PUBLISH_HOUR = 9 // 09:00 local

/**
 * The editorial source is one JSON file per category under
 * api/database/content/articles/ — small enough to write and review, and merged
 * here into a single ordered list. Array order is the publishing order, so the
 * files are sorted by name and the posts by their editorial `id`.
 */
const articles = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .flatMap((file) => JSON.parse(readFileSync(resolve(sourceDir, file), 'utf8')))
  .sort((a, b) => a.id - b.id)

const q = (value) => {
  if (value === null || value === undefined || value === '') return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/** Local wall-clock hour on a date in TIMEZONE → UTC "YYYY-MM-DD HH:mm:ss". */
const localToUtc = (dateParts, hour) => {
  const [year, month, day] = dateParts
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const asZone = (timestamp) => {
    const parts = formatter.formatToParts(new Date(timestamp))
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  }
  const offset = asZone(guess) - guess
  return new Date(guess - offset).toISOString().slice(0, 19).replace('T', ' ')
}

const addDays = (parts, days) => {
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

const today = new Date()
const todayParts = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()]

const PUBLISHED_COUNT = 10

const lines = []
lines.push('-- ============================================================================')
lines.push('--  Safe Home Network — blog content import (30 articles)')
lines.push('-- ----------------------------------------------------------------------------')
lines.push('--  GENERATED FILE — do not edit by hand.')
lines.push('--  Source: api/database/content/articles/*.json')
lines.push('--  Regenerate: node scripts/generate-blog-import.mjs')
lines.push('--')
lines.push('--  What it does')
lines.push('--    · 15 blog categories + tags (idempotent: matched on slug)')
lines.push('--    · 30 posts with SEO fields, metadata, category and tag links')
lines.push(`--    · articles 1–${PUBLISHED_COUNT} are published, the rest scheduled one per day`)
lines.push(`--      at ${String(PUBLISH_HOUR).padStart(2, '0')}:00 ${TIMEZONE}, stored in UTC`)
lines.push('--    · safe to re-run: posts are matched on slug and updated in place')
lines.push('--')
lines.push('--  Run api/database/migrations/2026-11-blog-cms-upgrade.sql FIRST.')
lines.push('--  Then import this file. Activate the cron job separately (docs/PUBLISHING.md).')
lines.push('-- ============================================================================')
lines.push('')
lines.push('SET NAMES utf8mb4;')
lines.push('')

/* ------------------------------- categories ------------------------------- */

const categories = []
for (const article of articles) {
  if (!categories.some((category) => category.slug === article.category.slug)) {
    categories.push(article.category)
  }
}

lines.push('/* ---------------------------- 1. Categories ---------------------------- */')
for (const category of categories) {
  lines.push(
    `INSERT INTO blog_categories (slug, name, description, seo_title, seo_description, sort_order, noindex)\n` +
      `VALUES (${q(category.slug)}, ${q(category.name)}, ${q(category.description ?? '')}, ${q(category.seoTitle ?? '')}, ${q(category.seoDescription ?? '')}, ${category.sortOrder ?? 0}, 0)\n` +
      `ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), seo_title = VALUES(seo_title), seo_description = VALUES(seo_description), sort_order = VALUES(sort_order);`,
  )
}
lines.push('')

/* --------------------------------- tags ---------------------------------- */

const tags = Array.from(new Set(articles.flatMap((article) => article.tags ?? []))).sort()
lines.push('/* ------------------------------- 2. Tags ------------------------------- */')
for (const tag of tags) {
  const slug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  lines.push(
    `INSERT INTO blog_tags (slug, name) VALUES (${q(slug)}, ${q(tag)})\nON DUPLICATE KEY UPDATE name = VALUES(name);`,
  )
}
lines.push('')

/* --------------------------------- posts --------------------------------- */

lines.push('/* ------------------------------- 3. Posts ------------------------------ */')

let publishedCount = 0
let scheduledCount = 0

articles.forEach((article, index) => {
  const body = renderBody(article)
  const words = wordCount(body)
  const isPublished = index < PUBLISHED_COUNT

  let publishedAt = 'NULL'
  let scheduledAt = 'NULL'

  if (isPublished) {
    // Spread the initial ten across the two weeks before the import so the
    // archive does not look like it was written in one afternoon.
    publishedAt = q(localToUtc(addDays(todayParts, -(14 - index), ), 9))
    publishedCount++
  } else {
    const offset = index - PUBLISHED_COUNT + 1
    scheduledAt = q(localToUtc(addDays(todayParts, offset), PUBLISH_HOUR))
    scheduledCount++
  }

  lines.push(`-- ${String(article.id).padStart(2, '0')}. ${article.title}`)
  lines.push(
    `INSERT INTO blog_posts\n` +
      `  (slug, title, category_id, status, excerpt, body, featured_image, featured_image_alt,\n` +
      `   seo_title, seo_description, seo_summary, focus_keyword, secondary_keywords,\n` +
      `   canonical_url, noindex, social_image, author_name, published_at, scheduled_at)\n` +
      `SELECT ${q(article.slug)}, ${q(article.title)}, c.id, ${q(isPublished ? 'published' : 'scheduled')},\n` +
      `       ${q(article.excerpt)}, ${q(body)},\n` +
      `       ${q(article.image)}, ${q(article.imageAlt)},\n` +
      `       ${q(article.seoTitle)}, ${q(article.seoDescription)}, ${q(article.seoSummary ?? '')},\n` +
      `       ${q(article.primaryKeyword)}, ${q((article.secondaryKeywords ?? []).join(', '))},\n` +
      `       NULL, 0, ${q(article.socialImage ?? article.image)}, ${q(article.author ?? 'Safe Home Network Editorial')},\n` +
      `       ${publishedAt}, ${scheduledAt}\n` +
      `  FROM blog_categories c WHERE c.slug = ${q(article.category.slug)}\n` +
      `ON DUPLICATE KEY UPDATE\n` +
      `  title = VALUES(title), category_id = VALUES(category_id), status = VALUES(status),\n` +
      `  excerpt = VALUES(excerpt), body = VALUES(body), featured_image = VALUES(featured_image),\n` +
      `  featured_image_alt = VALUES(featured_image_alt), seo_title = VALUES(seo_title),\n` +
      `  seo_description = VALUES(seo_description), seo_summary = VALUES(seo_summary),\n` +
      `  focus_keyword = VALUES(focus_keyword), secondary_keywords = VALUES(secondary_keywords),\n` +
      `  social_image = VALUES(social_image), published_at = VALUES(published_at),\n` +
      `  scheduled_at = VALUES(scheduled_at);`,
  )

  // Tag links: delete-then-insert keeps re-runs idempotent.
  lines.push(
    `DELETE bpt FROM blog_post_tags bpt\n` +
      `  INNER JOIN blog_posts b ON b.id = bpt.post_id\n` +
      `  INNER JOIN blog_tags t ON t.id = bpt.tag_id\n` +
      ` WHERE b.slug = ${q(article.slug)};`,
  )
  for (const tag of article.tags ?? []) {
    const slug = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    lines.push(
      `INSERT INTO blog_post_tags (post_id, tag_id)\n` +
        `SELECT b.id, t.id FROM blog_posts b, blog_tags t\n` +
        ` WHERE b.slug = ${q(article.slug)} AND t.slug = ${q(slug)};`,
    )
  }

  // Editorial metadata (search intent, CTA target, internal links, word count).
  const metadata = {
    search_intent: article.intent,
    target_audience: article.audience,
    article_length: `${words} words`,
    cta_target: article.cta?.label ?? '',
    internal_links: (article.internalLinks ?? []).map((link) => link.href).join('\n'),
    visual_direction: article.visual ?? '',
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue
    lines.push(
      `INSERT INTO blog_post_metadata (post_id, meta_key, meta_value)\n` +
        `SELECT b.id, ${q(key)}, ${q(value)} FROM blog_posts b WHERE b.slug = ${q(article.slug)}\n` +
        `ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);`,
    )
  }

  lines.push('')
})

/* ------------------------------- media rows ------------------------------ */

lines.push('/* --------------------------- 4. Media records -------------------------- */')
lines.push('-- The article illustrations ship as static files in /images/blog; these rows')
lines.push('-- make them visible in the admin media library. SVG uploads stay blocked in')
lines.push('-- the API on purpose (an SVG can carry script), so they are registered here.')
for (const article of articles) {
  lines.push(
    `INSERT INTO media (filename, original_name, mime_type, kind, size_bytes, path, alt_text, description, created_at)\n` +
      `SELECT ${q(article.image.split('/').pop())}, ${q(article.image.split('/').pop())}, 'image/svg+xml', 'svg', 0,\n` +
      `       ${q(article.image)}, ${q(article.imageAlt)}, ${q(article.seoSummary ?? article.title)}, ${q(localToUtc(todayParts, 9))}\n` +
      `  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM media m WHERE m.path = ${q(article.image)});`,
  )
}
lines.push('')

/* --------------------------------- verify -------------------------------- */

lines.push('/* ------------------------------- 5. Verify ----------------------------- */')
lines.push(`SELECT 'blog content imported' AS status,
       (SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL AND status = 'published') AS published_posts,
       (SELECT COUNT(*) FROM blog_posts WHERE deleted_at IS NULL AND status = 'scheduled') AS scheduled_posts,
       (SELECT COUNT(*) FROM blog_categories) AS categories,
       (SELECT COUNT(*) FROM blog_tags) AS tags,
       (SELECT COUNT(*) FROM blog_post_metadata) AS metadata_rows;
`)

writeFileSync(outPath, lines.join('\n'), 'utf8')

const totalWords = articles.reduce((sum, article) => sum + wordCount(renderBody(article)), 0)
console.log(
  `blog import written: ${articles.length} articles, ${publishedCount} published, ${scheduledCount} scheduled, ` +
    `${tags.length} tags, ${categories.length} categories, ${totalWords} words → ${outPath}`,
)

if (articles.length !== 30) {
  console.warn(`NOTE: ${30 - articles.length} article(s) still to write — the SQL covers what is in the JSON today.`)
}
