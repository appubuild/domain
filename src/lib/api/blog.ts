/**
 * Public blog data.
 *
 * Reads the published blog from the PHP API. Drafts and scheduled-but-not-due
 * posts are excluded server-side (BlogModel::PUBLIC_CONDITION), so the frontend
 * never has to filter them.
 *
 * Builds without VITE_API_BASE_URL fall back to the sample articles in
 * `blogDemoData.ts`, which is a separate chunk loaded on demand — production
 * visitors never download it.
 */
import { ApiError, apiRequest, apiRequestEnvelope, API_ENABLED } from './client'

export interface BlogPostSummary {
  id: number
  slug: string
  title: string
  excerpt: string | null
  featured_image: string | null
  featured_image_alt: string | null
  author: string
  published_at: string | null
  category: { slug: string; name: string } | null
  seo_title: string | null
  seo_description: string | null
  focus_keyword: string | null
  social_image: string | null
  view_count: number
  tags: Array<{ id: number; slug: string; name: string }>
}

export interface BlogPostDetail extends BlogPostSummary {
  body: string
  updated_at: string | null
  seo_summary: string | null
  secondary_keywords: string | null
  canonical_url: string | null
  noindex: number
  read_time_minutes: number
  metadata: Record<string, string>
  related: Array<{
    slug: string
    title: string
    excerpt: string | null
    featured_image: string | null
    featured_image_alt: string | null
    published_at: string | null
    category: { slug: string; name: string } | null
  }>
}

export interface BlogCategory {
  id: number
  slug: string
  name: string
  description: string | null
  seo_title: string | null
  seo_description: string | null
  noindex: number
  post_count: number
}

export interface BlogPage {
  items: BlogPostSummary[]
  total: number
  page: number
  perPage: number
  lastPage: number
}

/** True when the pages are showing the bundled sample articles. */
export const blogIsDemo = (): boolean => !API_ENABLED

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : fallback

const byDateDesc = (a: { published_at: string | null }, b: { published_at: string | null }): number =>
  (b.published_at ?? '').localeCompare(a.published_at ?? '')

const demoData = () => import('./blogDemoData')

export const fetchPosts = async (params: {
  page?: number
  perPage?: number
  category?: string
  tag?: string
  q?: string
} = {}): Promise<BlogPage> => {
  if (!API_ENABLED) {
    const { DEMO_POSTS } = await demoData()
    let items = [...DEMO_POSTS].sort(byDateDesc)
    if (params.category) items = items.filter((post) => post.category?.slug === params.category)
    if (params.tag) items = items.filter((post) => post.tags.some((tag) => tag.slug === params.tag))
    if (params.q) {
      const needle = params.q.toLowerCase()
      items = items.filter((post) => `${post.title} ${post.excerpt ?? ''}`.toLowerCase().includes(needle))
    }
    const perPage = params.perPage ?? 9
    const page = Math.max(1, params.page ?? 1)
    const total = items.length
    return {
      items: items.slice((page - 1) * perPage, page * perPage),
      total,
      page,
      perPage,
      lastPage: Math.max(1, Math.ceil(total / perPage)),
    }
  }

  const envelope = await apiRequestEnvelope<BlogPostSummary[]>('/v1/blog', {
    query: {
      page: params.page ?? 1,
      per_page: params.perPage ?? 9,
      category: params.category,
      tag: params.tag,
      q: params.q,
    },
  })

  const total = numberOr(envelope.meta?.total, envelope.data.length)
  const perPage = numberOr(envelope.meta?.per_page, params.perPage ?? 9)

  return {
    items: envelope.data,
    total,
    page: numberOr(envelope.meta?.page, params.page ?? 1),
    perPage,
    lastPage: Math.max(1, Math.ceil(total / Math.max(1, perPage))),
  }
}

export const fetchPost = async (slug: string): Promise<BlogPostDetail> => {
  if (!API_ENABLED) {
    const { DEMO_POSTS } = await demoData()
    const post = DEMO_POSTS.find((item) => item.slug === slug)
    if (!post) throw new ApiError('This guide is not available.', 404, 'not_found')
    return post
  }
  return apiRequest<BlogPostDetail>(`/v1/blog/${encodeURIComponent(slug)}`)
}

export const fetchCategories = async (): Promise<BlogCategory[]> => {
  if (!API_ENABLED) {
    const { DEMO_CATEGORIES } = await demoData()
    return DEMO_CATEGORIES
  }
  return apiRequest<BlogCategory[]>('/v1/blog/categories')
}

export const fetchCategory = async (slug: string): Promise<{ category: BlogCategory; posts: BlogPostSummary[]; total: number; lastPage: number }> => {
  if (!API_ENABLED) {
    const { DEMO_CATEGORIES, DEMO_POSTS } = await demoData()
    const category = DEMO_CATEGORIES.find((item) => item.slug === slug)
    if (!category) throw new ApiError('This topic is not available.', 404, 'not_found')
    const posts = DEMO_POSTS.filter((post) => post.category?.slug === slug).sort(byDateDesc)
    return { category, posts, total: posts.length, lastPage: 1 }
  }

  const payload = await apiRequest<{
    category: BlogCategory
    posts: BlogPostSummary[]
    pagination: Record<string, unknown>
  }>(`/v1/blog/categories/${encodeURIComponent(slug)}`)

  const total = numberOr(payload.pagination?.total, payload.posts.length)
  const perPage = numberOr(payload.pagination?.per_page, 10)

  return {
    category: payload.category,
    posts: payload.posts,
    total,
    lastPage: Math.max(1, Math.ceil(total / Math.max(1, perPage))),
  }
}

/** Adds stable ids to h2/h3 headings and returns a table of contents. */
export const withHeadingIds = (html: string): { html: string; toc: Array<{ id: string; text: string; level: number }> } => {
  const toc: Array<{ id: string; text: string; level: number }> = []
  const used = new Map<string, number>()

  const slug = (text: string): string => {
    const base =
      text
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'section'
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }

  const html2 = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g, (_match, level: string, attrs: string, inner: string) => {
    const id = slug(inner)
    toc.push({ id, text: inner.replace(/<[^>]+>/g, '').trim(), level: Number(level) })
    const cleaned = attrs.replace(/\sid="[^"]*"/, '')
    return `<h${level}${cleaned} id="${id}">${inner}</h${level}>`
  })

  return { html: html2, toc }
}

export const formatBlogDate = (value: string | null): string => {
  if (!value) return ''
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(date)
}
