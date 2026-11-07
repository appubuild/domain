/**
 * Blog content + illustration test suite.
 *
 *   npm run test:content
 *
 * Guards the editorial pipeline rather than the components:
 *
 *   · the 30 articles in api/database/content/articles/*.json are well formed
 *   · slugs, SEO lengths, CTA targets and internal links are consistent
 *   · every referenced illustration exists on disk, and nothing is orphaned
 *   · the bundled demo dataset (src/lib/api/blogDemoData.ts) stays in sync with
 *     the JSON and never links to an article a demo build cannot serve
 *   · the pure blog helpers (withHeadingIds, formatBlogDate) behave
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEMO_CATEGORIES, DEMO_POSTS } from '../src/lib/api/blogDemoData'
import { formatBlogDate, withHeadingIds } from '../src/lib/api/blog'

let pass = 0
let fail = 0

const check = (name: string, fn: () => void | boolean) => {
  try {
    const result = fn()
    if (result === false) throw new Error('assertion returned false')
    pass += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    fail += 1
    console.log(`  FAIL  ${name} — ${(error as Error).message}`)
  }
}

const eq = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
}
const ok = (value: boolean, message: string) => {
  if (!value) throw new Error(message)
}

const root = process.cwd()
const contentDir = resolve(root, 'api/database/content/articles')
const publicDir = resolve(root, 'public')
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Everything in the editorial source. */
const articles = readdirSync(contentDir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .flatMap((file) => JSON.parse(readFileSync(resolve(contentDir, file), 'utf8')) as ApiArticle[])
  .sort((a, b) => a.id - b.id)

interface ApiArticle {
  id: number
  title: string
  slug: string
  category: { slug: string; name: string; description?: string; seoTitle?: string; seoDescription?: string }
  primaryKeyword: string
  secondaryKeywords: string[]
  intent: string
  audience: string
  cta: { label: string; href: string }
  internalLinks: Array<{ label: string; href: string }>
  image: string
  imageAlt: string
  seoTitle: string
  seoDescription: string
  excerpt: string
  seoSummary: string
  author: string
  tags: string[]
  sections: unknown[]
  faqs: Array<{ q: string; a: string }>
}

const servicesSource = readFileSync(resolve(root, 'src/config/services.ts'), 'utf8')
const serviceSlugs = new Set([...servicesSource.matchAll(/^\s{4}slug: '([a-z0-9-]+)',$/gm)].map((match) => match[1]))

/* -------------------------------------------------------------------------- */

console.log('\n── Editorial source ──────────────────────────────────────────────')

check('30 articles with unique ids and slugs', () => {
  eq(articles.length, 30, 'article count')
  const ids = new Set(articles.map((article) => article.id))
  eq(ids.size, 30, 'unique ids')
  const slugs = new Set(articles.map((article) => article.slug))
  eq(slugs.size, 30, 'unique slugs')
})

check('every article carries the fields the import writes', () => {
  for (const article of articles) {
    ok(article.title.length > 10, `${article.id} title too short`)
    ok(article.slug === slugify(article.slug), `${article.id} slug is not URL-safe`)
    ok(article.image === `/images/blog/${article.slug}.svg`, `${article.id} image is not derived from the slug`)
    ok(article.imageAlt.length > 20, `${article.id} imageAlt too short`)
    ok(article.primaryKeyword.length > 3, `${article.id} primaryKeyword missing`)
    ok(article.secondaryKeywords.length >= 4, `${article.id} needs at least four secondary keywords`)
    ok(article.sections.length >= 5, `${article.id} needs at least five sections`)
    ok(article.faqs.length >= 3, `${article.id} needs at least three FAQs`)
    ok(article.tags.length >= 3, `${article.id} needs at least three tags`)
  }
})

check('SEO titles and descriptions stay inside search-result limits', () => {
  for (const article of articles) {
    ok(article.seoTitle.length <= 60, `${article.id} seoTitle is ${article.seoTitle.length} chars`)
    ok(article.seoDescription.length <= 160, `${article.id} seoDescription is ${article.seoDescription.length} chars`)
    ok(article.seoDescription.length >= 120, `${article.id} seoDescription is only ${article.seoDescription.length} chars`)
    ok(article.excerpt.length > 80, `${article.id} excerpt too short`)
  }
})

check('every CTA points at a real service page', () => {
  for (const article of articles) {
    const { href } = article.cta
    ok(href.startsWith('/services'), `${article.id} CTA should target /services…`)
    if (href !== '/services') {
      ok(serviceSlugs.has(href.replace('/services/', '')), `${article.id} CTA target ${href} is not a configured service`)
    }
  }
})

check('internal links only point at articles that exist', () => {
  const slugs = new Set(articles.map((article) => article.slug))
  for (const article of articles) {
    for (const link of article.internalLinks) {
      ok(link.href.startsWith('/blog/'), `${article.id} internal link ${link.href} should be a blog URL`)
      ok(slugs.has(link.href.replace('/blog/', '')), `${article.id} links to missing article ${link.href}`)
    }
  }
})

check('categories are consistent across articles', () => {
  const seen = new Map<string, { name: string; sortOrder: number }>()
  for (const article of articles) {
    const { slug, name } = article.category
    const existing = seen.get(slug)
    if (existing) eq(existing.name, name, `category name for ${slug}`)
    seen.set(slug, { name, sortOrder: 0 })
    ok(Boolean(article.category.description), `${slug} has no category description`)
  }
  eq(seen.size, 15, 'category count')
})

/* -------------------------------------------------------------------------- */

console.log('\n── Illustrations ─────────────────────────────────────────────────')

check('every referenced illustration exists', () => {
  for (const article of articles) {
    const file = resolve(publicDir, article.image.replace(/^\//, ''))
    ok(existsSync(file), `missing image ${article.image}`)
  }
})

check('no illustrations are orphaned', () => {
  const referenced = new Set(articles.map((article) => article.image.split('/').pop()))
  const files = readdirSync(resolve(publicDir, 'images/blog')).filter((file) => file.endsWith('.svg'))
  eq(files.length, 30, 'svg count')
  for (const file of files) ok(referenced.has(file), `orphaned illustration ${file}`)
})

check('illustrations are self-contained SVG', () => {
  for (const article of articles) {
    const svg = readFileSync(resolve(publicDir, article.image.replace(/^\//, '')), 'utf8')
    ok(svg.startsWith('<svg'), `${article.image} is not an SVG document`)
    ok(svg.includes('viewBox="0 0 1200 675"'), `${article.image} has the wrong viewBox`)
    ok(svg.includes('<title') && svg.includes('<desc'), `${article.image} needs a title and description`)
    ok(!/xlink:href|href="http/.test(svg), `${article.image} references an external resource`)
    ok(!/<image\b/.test(svg), `${article.image} embeds raster data`)
  }
})

/* -------------------------------------------------------------------------- */

console.log('\n── Demo dataset ──────────────────────────────────────────────────')

check('demo dataset matches the first ten published articles', () => {
  eq(DEMO_POSTS.length, 10, 'demo post count')
  for (const [index, post] of DEMO_POSTS.entries()) {
    eq(post.slug, articles[index].slug, `demo post ${index} slug`)
    eq(post.title, articles[index].title, `demo post ${index} title`)
  }
})

check('demo posts carry a rendered body with headings and FAQs', () => {
  for (const post of DEMO_POSTS) {
    ok((post.body.match(/<h2>/g) ?? []).length >= 4, `${post.slug} has too few h2 blocks`)
    ok(post.body.includes('<h3>Frequently asked questions</h3>') || post.body.includes('Frequently asked questions'), `${post.slug} has no FAQ block`)
    ok(post.body.includes('article-disclaimer'), `${post.slug} is missing the disclaimer`)
    ok(post.read_time_minutes >= 3, `${post.slug} read time`)
  }
})

check('demo posts never link to an article the demo cannot serve', () => {
  const slugs = new Set(DEMO_POSTS.map((post) => post.slug))
  for (const post of DEMO_POSTS) {
    for (const match of post.body.matchAll(/href="\/blog\/([^"]+)"/g)) {
      ok(slugs.has(match[1]), `${post.slug} links to unavailable article ${match[1]}`)
    }
    for (const related of post.related) ok(slugs.has(related.slug), `${post.slug} related link ${related.slug}`)
  }
})

check('demo categories cover the editorial taxonomy', () => {
  const editorial = new Set(articles.map((article) => article.category.slug))
  eq(DEMO_CATEGORIES.length, editorial.size, 'demo category count')
  for (const category of DEMO_CATEGORIES) ok(editorial.has(category.slug), `unknown demo category ${category.slug}`)
  const counted = DEMO_CATEGORIES.reduce((sum, category) => sum + category.post_count, 0)
  eq(counted, DEMO_POSTS.length, 'post_count total')
})

/* -------------------------------------------------------------------------- */

console.log('\n── Helpers ───────────────────────────────────────────────────────')

check('withHeadingIds adds stable ids and builds a table of contents', () => {
  const { html, toc } = withHeadingIds('<h2>First steps</h2><p>x</p><h3>Nested detail</h3><h2>First steps</h2>')
  eq(toc.length, 3, 'toc length')
  eq(toc[0].id, 'first-steps', 'first id')
  eq(toc[1].level, 3, 'second level')
  eq(toc[2].id, 'first-steps-2', 'duplicate headings get a suffix')
  ok(html.includes('id="first-steps"'), 'html keeps the id')
})

check('formatBlogDate renders a readable date and tolerates junk', () => {
  eq(formatBlogDate('2026-11-07 14:00:00').startsWith('November'), true, 'November expected')
  eq(formatBlogDate(null), '', 'null date')
  eq(formatBlogDate('not-a-date'), '', 'invalid date')
})

check('sitemap lists the blog hub and every category', () => {
  const sitemap = readFileSync(resolve(publicDir, 'sitemap.xml'), 'utf8')
  ok(sitemap.includes('<loc>https://safehomenetwork.com/blog</loc>'), 'blog hub missing from sitemap')
  for (const article of articles) {
    ok(sitemap.includes(`/blog/category/${article.category.slug}<`), `category ${article.category.slug} missing from sitemap`)
  }
})

/* -------------------------------------------------------------------------- */

console.log('\n── Database schema ───────────────────────────────────────────────')

const importSql = readFileSync(resolve(root, 'api/database/blog-content-import.sql'), 'utf8')
const schemaSql = readFileSync(resolve(root, 'api/database/schema.sql'), 'utf8')
const migrationSql = readFileSync(resolve(root, 'api/database/migrations/2026-11-blog-cms-upgrade.sql'), 'utf8')
const idempotentSql = readFileSync(
  resolve(root, 'api/database/migrations/2026-11-blog-cms-upgrade-idempotent.sql'),
  'utf8',
)

const tableBlock = (source: string, table: string): string => {
  const start = source.search(new RegExp(`CREATE TABLE (IF NOT EXISTS )?\x60${table}\x60`))
  if (start === -1) return ''
  const end = source.indexOf(';', start)
  return source.slice(start, end === -1 ? undefined : end)
}

check('the import only writes columns the schema defines', () => {
  const inserts = [...importSql.matchAll(/INSERT INTO (\w+)\s*\(([\s\S]*?)\)\s*(?:SELECT|VALUES)/g)]
  ok(inserts.length >= 5, `expected several inserts, found ${inserts.length}`)
  for (const [, table, columnList] of inserts) {
    const block = tableBlock(schemaSql, table)
    ok(block !== '', `schema.sql has no CREATE TABLE for ${table}`)
    for (const raw of columnList.split(',')) {
      const column = raw.trim().replace(/`/g, '')
      if (!column) continue
      ok(block.includes(`\x60${column}\x60`), `schema.sql is missing ${table}.${column}`)
    }
  }
})

check('idempotent migration guards every change the original makes', () => {
  const pairs = (source: string) =>
    [...source.matchAll(/TABLE_NAME = '([a-z_]+)' AND COLUMN_NAME = '([a-z_]+)'/g)].map(
      (match) => `${match[1]}.${match[2]}`,
    )
  const original = [...migrationSql.matchAll(/CALL shn_add_column\('([a-z_]+)',\s*'([a-z_]+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  )
  const guarded = new Set(pairs(idempotentSql))
  eq(original.length, 23, 'column calls in the original migration')
  for (const entry of original) ok(guarded.has(entry), `idempotent migration does not guard ${entry}`)

  const indexes = [...migrationSql.matchAll(/CALL shn_add_index\('([a-z_]+)',\s*'([a-z_]+)'/g)].map(
    (match) => `${match[1]}.${match[2]}`,
  )
  for (const entry of indexes) {
    const [table, index] = entry.split('.')
    ok(
      idempotentSql.includes(`TABLE_NAME = '${table}' AND INDEX_NAME = '${index}'`),
      `idempotent migration does not guard index ${entry}`,
    )
  }
  ok(!/DELIMITER/.test(idempotentSql.replace(/^--.*$/gm, '')), 'idempotent migration must not use DELIMITER')
})

check('the pre-flight check covers every column the import needs', () => {
  const checkSql = readFileSync(resolve(root, 'api/database/check-cms-schema.sql'), 'utf8')
  const inserts = [...importSql.matchAll(/INSERT INTO (\w+)\s*\(([\s\S]*?)\)\s*(?:SELECT|VALUES)/g)]
  for (const [, table, columnList] of inserts) {
    for (const raw of columnList.split(',')) {
      const column = raw.trim().replace(/`/g, '')
      if (!column) continue
      ok(
        checkSql.includes(`SELECT '${table}', '${column}'`) || checkSql.includes(`SELECT '${table}' AS table_name, '${column}' AS column_name`),
        `check-cms-schema.sql does not test ${table}.${column}`,
      )
    }
  }
})

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
