/**
 * Builds src/lib/api/blogDemoData.ts — the sample articles shown when the site
 * is built without VITE_API_BASE_URL (demo mode).
 *
 *   node scripts/generate-blog-demo.mjs
 *
 * The module is imported dynamically by src/lib/api/blog.ts, so production
 * builds never download it: it only loads when the blog is opened in a build
 * that has no API connection.
 *
 * Content comes from the same editorial JSON as the SQL import, and is rendered
 * with the same renderer, so the demo pages are byte-identical to what the API
 * would return for those posts.
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadArticles, renderBody, wordCount } from './lib/render-article.mjs'

const root = process.cwd()
const outPath = resolve(root, 'src/lib/api/blogDemoData.ts')

/** How many of the articles are published on import (see the import generator). */
const PUBLISHED_COUNT = 10

const articles = await loadArticles(root)
const published = articles.slice(0, PUBLISHED_COUNT)

const tagId = new Map()
let nextTagId = 1
const tagIdFor = (name) => {
  if (!tagId.has(name)) tagId.set(name, nextTagId++)
  return tagId.get(name)
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const publishedSlugs = new Set(published.map((article) => article.slug))

/**
 * Cross-links to articles that are scheduled rather than published would 404 in
 * a demo build, so they are dropped from the rendered body. Service links and
 * links between published guides are kept.
 */
const pruneUnpublishedLinks = (html) =>
  html.replace(/<li><a href="\/blog\/([^"]+)">[\s\S]*?<\/a><\/li>/g, (match, slug) =>
    publishedSlugs.has(slug) ? match : '',
  )

const summaries = published.map((article, index) => {
  const body = pruneUnpublishedLinks(renderBody(article))
  const words = wordCount(body)
  return {
    article,
    body,
    words,
    // Publishing date is expressed relative to "now" so the demo archive always
    // looks current, however long ago the file was generated.
    daysAgo: 13 - index,
  }
})

const relatedFor = (slug, categorySlug) => {
  const same = summaries.filter((entry) => entry.article.slug !== slug && entry.article.category.slug === categorySlug)
  const others = summaries.filter((entry) => entry.article.slug !== slug && entry.article.category.slug !== categorySlug)
  return [...same, ...others].slice(0, 3)
}

const postLiteral = ({ article, body, words, daysAgo }) => {
  const tags = (article.tags ?? []).map((name) => ({
    id: tagIdFor(name),
    slug: slugify(name),
    name,
  }))
  const related = relatedFor(article.slug, article.category.slug).map((entry) => ({
    slug: entry.article.slug,
    title: entry.article.title,
    excerpt: entry.article.excerpt,
    featured_image: entry.article.image,
    featured_image_alt: entry.article.imageAlt,
    published_at: `isoDaysAgo(${entry.daysAgo}, 9)`,
    category: { slug: entry.article.category.slug, name: entry.article.category.name },
  }))

  const metadata = {
    search_intent: article.intent,
    target_audience: article.audience,
    article_length: `${words} words`,
    cta_target: article.cta?.label ?? '',
    internal_links: (article.internalLinks ?? []).map((link) => link.href).join('\n'),
    visual_direction: article.visual ?? '',
  }

  return `  {
    id: ${article.id},
    slug: ${JSON.stringify(article.slug)},
    title: ${JSON.stringify(article.title)},
    excerpt: ${JSON.stringify(article.excerpt)},
    featured_image: ${JSON.stringify(article.image)},
    featured_image_alt: ${JSON.stringify(article.imageAlt)},
    author: ${JSON.stringify(article.author)},
    published_at: isoDaysAgo(${daysAgo}, 9),
    category: { slug: ${JSON.stringify(article.category.slug)}, name: ${JSON.stringify(article.category.name)} },
    seo_title: ${JSON.stringify(article.seoTitle)},
    seo_description: ${JSON.stringify(article.seoDescription)},
    focus_keyword: ${JSON.stringify(article.primaryKeyword)},
    social_image: ${JSON.stringify(article.image)},
    view_count: 0,
    tags: ${JSON.stringify(tags)},
    body: ${JSON.stringify(body)},
    updated_at: isoDaysAgo(${daysAgo}, 9),
    seo_summary: ${JSON.stringify(article.seoSummary ?? '')},
    secondary_keywords: ${JSON.stringify((article.secondaryKeywords ?? []).join(', '))},
    canonical_url: null,
    noindex: 0,
    read_time_minutes: ${Math.max(3, Math.round(words / 220))},
    metadata: ${JSON.stringify(metadata)},
    related: ${JSON.stringify(related)},
  }`
}

const categoryLiterals = []
const seenCategories = new Set()
for (const article of articles) {
  const { category } = article
  if (seenCategories.has(category.slug)) continue
  seenCategories.add(category.slug)
  const postCount = summaries.filter((entry) => entry.article.category.slug === category.slug).length
  categoryLiterals.push(`  {
    id: ${categoryLiterals.length + 1},
    slug: ${JSON.stringify(category.slug)},
    name: ${JSON.stringify(category.name)},
    description: ${JSON.stringify(category.description ?? '')},
    seo_title: ${JSON.stringify(category.seoTitle ?? '')},
    seo_description: ${JSON.stringify(category.seoDescription ?? '')},
    noindex: 0,
    post_count: ${postCount},
  }`)
}

const output = `/**
 * GENERATED FILE — do not edit by hand.
 *
 *   node scripts/generate-blog-demo.mjs
 *
 * Sample articles for builds without VITE_API_BASE_URL. Imported dynamically by
 * ./blog.ts, so it is a separate chunk that production never downloads.
 *
 * Source: api/database/content/articles/*.json (first ${PUBLISHED_COUNT} articles)
 */

import type { BlogCategory, BlogPostDetail } from './blog'

/** ISO timestamp for ${'{days}'} ago at ${'{hour}'}:00 UTC — keeps the demo archive current. */
const isoDaysAgo = (days: number, hour: number): string => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export const DEMO_POSTS: BlogPostDetail[] = [
${summaries.map(postLiteral).join(',\n')},
]

export const DEMO_CATEGORIES: BlogCategory[] = [
${categoryLiterals.join(',\n')},
]

export const DEMO_NOTE =
  'Showing sample articles bundled with this build. Set VITE_API_BASE_URL and import the CMS content to publish your own.'
`

writeFileSync(outPath, output, 'utf8')

const totalWords = summaries.reduce((sum, entry) => sum + entry.words, 0)
console.log(
  `blog demo data written: ${summaries.length} posts, ${categoryLiterals.length} categories, ${totalWords} words → ${outPath}`,
)
