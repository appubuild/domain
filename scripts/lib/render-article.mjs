/**
 * Shared article renderer.
 *
 * Used by both generators so the SQL import, the demo dataset and the public
 * page never disagree about how a section block becomes HTML:
 *
 *   scripts/generate-blog-import.mjs   → api/database/blog-content-import.sql
 *   scripts/generate-blog-demo.mjs     → src/lib/api/blogDemoData.ts
 */

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** Renders the short **bold** / *emphasis* / `code` subset used in article copy. */
export const inline = (text) =>
  escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

export const renderTable = (table) => {
  if (!table) return ''
  const head = `<thead><tr>${table.head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
  const body = `<tbody>${table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody>`
  return `<figure class="article-table"><table>${head}${body}</table></figure>`
}

export const renderBody = (article) => {
  const parts = []

  for (const section of article.sections ?? []) {
    if (section.h2) parts.push(`<h2>${inline(section.h2)}</h2>`)
    if (section.h3) parts.push(`<h3>${inline(section.h3)}</h3>`)
    for (const para of section.paras ?? []) parts.push(`<p>${inline(para)}</p>`)
    if (section.bullets?.length) {
      parts.push(`<ul>${section.bullets.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
    }
    if (section.ordered?.length) {
      parts.push(`<ol>${section.ordered.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`)
    }
    if (section.table) parts.push(renderTable(section.table))
    if (section.note) parts.push(`<blockquote><p>${inline(section.note)}</p></blockquote>`)
  }

  if (article.faqs?.length) {
    parts.push('<h2>Frequently asked questions</h2>')
    for (const faq of article.faqs) {
      parts.push(`<h3>${inline(faq.q)}</h3><p>${inline(faq.a)}</p>`)
    }
  }

  // Internal links: the service page for the topic plus related guides.
  const links = []
  if (article.cta?.href) links.push(`<li><a href="${article.cta.href}">${inline(article.cta.label)}</a></li>`)
  for (const link of article.internalLinks ?? []) {
    links.push(`<li><a href="${link.href}">${inline(link.label)}</a></li>`)
  }
  if (links.length) {
    parts.push(`<h2>Where to go next</h2><ul>${links.join('')}</ul>`)
  }

  parts.push(
    '<p class="article-disclaimer"><em>Safe Home Network is a connection and referral platform, not a contractor. This guide is general information for homeowners and is not a diagnosis, a quote or a guarantee of any outcome. Work involving gas, mains wiring, structural changes or working at height should be carried out by a licensed professional.</em></p>',
  )

  return parts.join('\n')
}

export const wordCount = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length

/** Ordered list of articles from api/database/content/articles/*.json. */
export const loadArticles = async (root) => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const dir = resolve(root, 'api/database/content/articles')
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .flatMap((file) => JSON.parse(readFileSync(resolve(dir, file), 'utf8')))
    .sort((a, b) => a.id - b.id)
}
