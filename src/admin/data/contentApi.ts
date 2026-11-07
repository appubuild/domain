/**
 * Content API for the blog editor, page builder and category manager.
 *
 * One module, two modes — exactly like the rest of the console:
 *   · API mode  → REST calls to the PHP API (cookie + CSRF, no tokens)
 *   · demo mode → the same shapes stored in localStorage so the editor can be
 *                 exercised without a server
 *
 * All timestamps are ISO strings in UTC. The editor converts the wall-clock
 * value typed in a datetime-local input from the configured publishing zone
 * (America/New_York) to UTC before sending it, and back when displaying.
 */
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import { apiClient } from './apiClient'
import { buildSeedWorkspace } from './seed'

export type ContentStatus = 'draft' | 'published' | 'scheduled'

export interface ContentTag {
  id: string
  slug: string
  name: string
  postCount?: number
}

export interface ContentCategory {
  id: string
  slug: string
  name: string
  description: string
  seoTitle: string
  seoDescription: string
  sortOrder: number
  noindex: boolean
  postCount?: number
}

export interface ContentPost {
  id: string
  slug: string
  title: string
  categoryId: string | null
  categoryName: string
  status: ContentStatus
  excerpt: string
  body: string
  featuredImage: string
  featuredImageAlt: string
  seoTitle: string
  seoDescription: string
  seoSummary: string
  focusKeyword: string
  secondaryKeywords: string
  canonicalUrl: string
  noindex: boolean
  socialImage: string
  author: string
  publishedAt: string
  scheduledAt: string
  updatedAt: string
  readTimeMinutes: number
  viewCount: number
  tags: ContentTag[]
  metadata: Record<string, string>
}

export interface ContentPage {
  id: string
  slug: string
  title: string
  template: 'standard' | 'legal' | 'landing'
  status: ContentStatus
  excerpt: string
  body: string
  seoTitle: string
  seoDescription: string
  focusKeyword: string
  secondaryKeywords: string
  canonicalUrl: string
  noindex: boolean
  ogImage: string
  pageGroup: string
  sortOrder: number
  publishedAt: string
  scheduledAt: string
  updatedAt: string
}

export interface MediaAsset {
  id: string
  filename: string
  path: string
  mimeType: string
  altText: string
  sizeBytes: number
}

export interface ListResult<T> {
  items: T[]
  total: number
  page: number
  perPage: number
}

export interface PostInput {
  title: string
  slug: string
  categoryId: string | null
  status: ContentStatus
  excerpt: string
  body: string
  featuredImage: string
  featuredImageAlt: string
  seoTitle: string
  seoDescription: string
  seoSummary: string
  focusKeyword: string
  secondaryKeywords: string
  canonicalUrl: string
  noindex: boolean
  socialImage: string
  author: string
  publishedAt: string
  scheduledAt: string
  tagIds: string[]
  metadata: Record<string, string>
}

export interface PageInput {
  title: string
  slug: string
  template: 'standard' | 'legal' | 'landing'
  status: ContentStatus
  excerpt: string
  body: string
  seoTitle: string
  seoDescription: string
  focusKeyword: string
  secondaryKeywords: string
  canonicalUrl: string
  noindex: boolean
  ogImage: string
  pageGroup: string
  sortOrder: number
  scheduledAt: string
}

const isApi = (): boolean => ADMIN_CONFIG.api.enabled

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)

const toBool = (value: unknown): boolean => value === true || value === 1 || value === '1'

const metaNumber = (meta: Record<string, unknown> | undefined, key: string, fallback: number): number => {
  const value = meta?.[key]
  return typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : fallback
}

const iso = (value: unknown): string => (typeof value === 'string' && value ? value : '')

/** UTC ISO → "YYYY-MM-DDTHH:mm" in the publishing timezone (for datetime-local). */
export const utcToLocalInput = (utc: string, timeZone = ADMIN_CONFIG.publishing.timezone): string => {
  if (!utc) return ''
  const date = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`
}

/** Wall-clock "YYYY-MM-DDTHH:mm" in the publishing zone → UTC "YYYY-MM-DD HH:mm:ss". */
export const localInputToUtc = (local: string, timeZone = ADMIN_CONFIG.publishing.timezone): string => {
  if (!local) return ''
  const [datePart, timePart = '00:00'] = local.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)

  // Guess UTC, then correct by the zone offset at that instant (handles DST).
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const asZone = (timestamp: number): number => {
    const parts = formatter.formatToParts(new Date(timestamp))
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  }
  const offset = asZone(guess) - guess
  const utc = new Date(guess - offset)
  return `${utc.toISOString().slice(0, 10)} ${utc.toISOString().slice(11, 19)}`
}

export const formatUtc = (utc: string, timeZone = ADMIN_CONFIG.publishing.timezone): string => {
  if (!utc) return '—'
  const date = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export const readingMinutes = (html: string): number => {
  const words = html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

/* -------------------------------------------------------------------------- */
/*  API mappers                                                               */
/* -------------------------------------------------------------------------- */

interface ApiTag { id: number; slug: string; name: string; post_count?: number }
interface ApiCategory {
  id: number
  slug: string
  name: string
  description?: string | null
  seo_title?: string | null
  seo_description?: string | null
  sort_order?: number
  noindex?: number | boolean
  post_count?: number
}
interface ApiPost {
  id: number
  slug: string
  title: string
  category_id: number | null
  category_name?: string | null
  status: ContentStatus
  excerpt?: string | null
  body?: string | null
  featured_image?: string | null
  featured_image_alt?: string | null
  seo_title?: string | null
  seo_description?: string | null
  seo_summary?: string | null
  focus_keyword?: string | null
  secondary_keywords?: string | null
  canonical_url?: string | null
  noindex?: number | boolean
  social_image?: string | null
  author?: string | null
  published_at?: string | null
  scheduled_at?: string | null
  updated_at?: string | null
  view_count?: number
  read_time_minutes?: number
  tags?: ApiTag[]
  tag_ids?: number[]
  metadata?: Record<string, string>
}
interface ApiPage {
  id: number
  slug: string
  title: string
  template: 'standard' | 'legal' | 'landing'
  status: ContentStatus
  excerpt?: string | null
  body?: string | null
  seo_title?: string | null
  seo_description?: string | null
  focus_keyword?: string | null
  secondary_keywords?: string | null
  canonical_url?: string | null
  noindex?: number | boolean
  og_image?: string | null
  page_group?: string | null
  sort_order?: number
  published_at?: string | null
  scheduled_at?: string | null
  updated_at?: string | null
}

const mapTag = (tag: ApiTag): ContentTag => ({
  id: String(tag.id),
  slug: tag.slug,
  name: tag.name,
  postCount: tag.post_count,
})

const mapCategory = (category: ApiCategory): ContentCategory => ({
  id: String(category.id),
  slug: category.slug,
  name: category.name,
  description: category.description ?? '',
  seoTitle: category.seo_title ?? '',
  seoDescription: category.seo_description ?? '',
  sortOrder: Number(category.sort_order ?? 0),
  noindex: toBool(category.noindex),
  postCount: category.post_count,
})

const mapPost = (post: ApiPost): ContentPost => ({
  id: String(post.id),
  slug: post.slug,
  title: post.title,
  categoryId: post.category_id === null ? null : String(post.category_id),
  categoryName: post.category_name ?? '',
  status: post.status,
  excerpt: post.excerpt ?? '',
  body: post.body ?? '',
  featuredImage: post.featured_image ?? '',
  featuredImageAlt: post.featured_image_alt ?? '',
  seoTitle: post.seo_title ?? '',
  seoDescription: post.seo_description ?? '',
  seoSummary: post.seo_summary ?? '',
  focusKeyword: post.focus_keyword ?? '',
  secondaryKeywords: post.secondary_keywords ?? '',
  canonicalUrl: post.canonical_url ?? '',
  noindex: toBool(post.noindex),
  socialImage: post.social_image ?? '',
  author: post.author ?? 'Editorial team',
  publishedAt: iso(post.published_at),
  scheduledAt: iso(post.scheduled_at),
  updatedAt: iso(post.updated_at),
  readTimeMinutes: Number(post.read_time_minutes ?? 1),
  viewCount: Number(post.view_count ?? 0),
  tags: (post.tags ?? []).map(mapTag),
  metadata: post.metadata ?? {},
})

const mapPage = (page: ApiPage): ContentPage => ({
  id: String(page.id),
  slug: page.slug,
  title: page.title,
  template: page.template,
  status: page.status,
  excerpt: page.excerpt ?? '',
  body: page.body ?? '',
  seoTitle: page.seo_title ?? '',
  seoDescription: page.seo_description ?? '',
  focusKeyword: page.focus_keyword ?? '',
  secondaryKeywords: page.secondary_keywords ?? '',
  canonicalUrl: page.canonical_url ?? '',
  noindex: toBool(page.noindex),
  ogImage: page.og_image ?? '',
  pageGroup: page.page_group ?? '',
  sortOrder: Number(page.sort_order ?? 0),
  publishedAt: iso(page.published_at),
  scheduledAt: iso(page.scheduled_at),
  updatedAt: iso(page.updated_at),
})

const postPayload = (input: PostInput): Record<string, unknown> => ({
  title: input.title,
  slug: input.slug,
  category_id: input.categoryId ? Number(input.categoryId) : null,
  status: input.status,
  excerpt: input.excerpt,
  body: input.body,
  featured_image: input.featuredImage || null,
  featured_image_alt: input.featuredImageAlt || null,
  seo_title: input.seoTitle || null,
  seo_description: input.seoDescription || null,
  seo_summary: input.seoSummary || null,
  focus_keyword: input.focusKeyword || null,
  secondary_keywords: input.secondaryKeywords || null,
  canonical_url: input.canonicalUrl || null,
  noindex: input.noindex,
  social_image: input.socialImage || null,
  author_name: input.author || 'Editorial team',
  published_at: input.status === 'scheduled' ? input.scheduledAt : input.publishedAt || null,
  scheduled_at: input.scheduledAt || null,
  tag_ids: input.tagIds.map(Number).filter((id) => Number.isFinite(id)),
  metadata: input.metadata,
})

const pagePayload = (input: PageInput): Record<string, unknown> => ({
  title: input.title,
  slug: input.slug,
  template: input.template,
  status: input.status,
  excerpt: input.excerpt,
  body: input.body,
  seo_title: input.seoTitle || null,
  seo_description: input.seoDescription || null,
  focus_keyword: input.focusKeyword || null,
  secondary_keywords: input.secondaryKeywords || null,
  canonical_url: input.canonicalUrl || null,
  noindex: input.noindex,
  og_image: input.ogImage || null,
  page_group: input.pageGroup || null,
  sort_order: input.sortOrder,
  scheduled_at: input.scheduledAt || null,
})

/* -------------------------------------------------------------------------- */
/*  Demo (localStorage) store                                                 */
/* -------------------------------------------------------------------------- */

interface LocalStore {
  version: number
  posts: ContentPost[]
  pages: ContentPage[]
  categories: ContentCategory[]
  tags: ContentTag[]
}

const LOCAL_KEY = 'shn.admin.content.v2'

/**
 * Demo-mode categories mirror the 15 categories the content import creates, so
 * the local store, the editor dropdowns and the public archive all agree on the
 * same taxonomy when the console runs without an API.
 */
const demoCategories = (): ContentCategory[] =>
  [
    ['appliance-repair', 'Appliance Repair', 'Diagnostics, repair-or-replace decisions and the appliances a home actually runs on.'],
    ['electrical', 'Electrical Services', 'Safe diagnostics for the electrical issues homeowners can observe.'],
    ['plumbing', 'Plumbing', 'Leaks, pressure problems, water heaters and drains.'],
    ['hvac', 'HVAC', 'Heating and cooling checks a homeowner can safely make.'],
    ['roofing', 'Roofing', 'Replacement and installation: materials, timelines and quotes.'],
    ['roof-repair', 'Roof Repair', 'Targeted repairs, leak scoping and storm claims.'],
    ['water-damage', 'Water Damage Restoration', 'Immediate mitigation, drying timelines and mold risk.'],
    ['pest-control', 'Pest Control', 'Termites, rodents and the early signs that make treatment cheaper.'],
    ['kitchen-remodeling', 'Kitchen Remodeling', 'Budgets, lead times and sequencing a kitchen project.'],
    ['bathroom-remodeling', 'Bathroom Remodeling', 'Ventilation, waterproofing and layout constraints.'],
    ['window-installation', 'Window Installation', 'Repair-or-replace calls and energy ratings.'],
    ['door-installation', 'Door Installation', 'Entry doors: sizing, security and installation details.'],
    ['concrete-paving', 'Concrete & Paving', 'Driveways, patios and how a slab is built.'],
    ['locksmith', 'Locksmith', 'Rekeying, replacement and avoiding lockout scams.'],
    ['hiring-a-pro', 'Hiring a Pro', 'How to vet, quote and manage a home service professional.'],
  ].map(([slug, name, description], index) => ({
    id: `cat-${slug}`,
    slug,
    name,
    description,
    seoTitle: '',
    seoDescription: '',
    sortOrder: index,
    noindex: false,
  }))

/** Seed posts use display names; map them onto the canonical category slugs. */
const DEMO_CATEGORY_ALIASES: Record<string, string> = {
  roofing: 'roofing',
  'roof repair': 'roof-repair',
  hvac: 'hvac',
  'ac repair': 'hvac',
  restoration: 'water-damage',
  'water damage': 'water-damage',
  electrical: 'electrical',
  locksmith: 'locksmith',
  remodeling: 'kitchen-remodeling',
  kitchen: 'kitchen-remodeling',
  bathroom: 'bathroom-remodeling',
  plumbing: 'plumbing',
  appliance: 'appliance-repair',
  'appliance repair': 'appliance-repair',
  windows: 'window-installation',
  doors: 'door-installation',
  concrete: 'concrete-paving',
  pest: 'pest-control',
}

const demoStore = (): LocalStore => {
  const seed = buildSeedWorkspace()
  const categories = demoCategories()
  const posts: ContentPost[] = seed.posts.map((post, index) => {
    const alias = DEMO_CATEGORY_ALIASES[post.category.toLowerCase()]
    const category =
      categories.find((item) => item.slug === alias) ??
      categories.find((item) => item.name.toLowerCase() === post.category.toLowerCase()) ??
      categories.find((item) => item.name.toLowerCase().includes(post.category.toLowerCase())) ??
      categories[0]
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      categoryId: category.id,
      categoryName: category.name,
      status: post.status,
      excerpt: post.excerpt,
      body: `<p>${post.excerpt}</p>`,
      featuredImage: post.featuredImage,
      featuredImageAlt: post.title,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      seoSummary: '',
      focusKeyword: '',
      secondaryKeywords: '',
      canonicalUrl: '',
      noindex: false,
      socialImage: '',
      author: post.author,
      publishedAt: post.publishedAt,
      scheduledAt: '',
      updatedAt: post.updatedAt,
      readTimeMinutes: 4 + index,
      viewCount: 0,
      tags: [],
      metadata: {},
    }
  })
  const pages: ContentPage[] = seed.pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    template: page.template,
    status: page.status,
    excerpt: page.excerpt,
    body: `<p>${page.excerpt}</p>`,
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    focusKeyword: '',
    secondaryKeywords: '',
    canonicalUrl: '',
    noindex: false,
    ogImage: '',
    pageGroup: 'Legal',
    sortOrder: 0,
    publishedAt: page.updatedAt,
    scheduledAt: '',
    updatedAt: page.updatedAt,
  }))
  return { version: 2, posts, pages, categories, tags: [] }
}

const readLocal = (): LocalStore => {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (!raw) return demoStore()
    const parsed = JSON.parse(raw) as LocalStore
    if (!parsed || parsed.version !== 2) return demoStore()
    return parsed
  } catch {
    return demoStore()
  }
}

const writeLocal = (store: LocalStore): void => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store))
  } catch {
    /* storage full or disabled — the UI still works for this session */
  }
}

const localId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export const contentApi = {
  get mode(): 'api' | 'local' {
    return isApi() ? 'api' : 'local'
  },

  /* ------------------------------ categories ----------------------------- */

  async listCategories(): Promise<ContentCategory[]> {
    if (isApi()) {
      const rows = await apiClient.request<ApiCategory[]>('/admin/blog/categories')
      return rows.map(mapCategory)
    }
    return readLocal().categories
  },

  async createCategory(input: Omit<ContentCategory, 'id' | 'postCount'>): Promise<ContentCategory> {
    if (isApi()) {
      const row = await apiClient.request<ApiCategory>('/admin/blog/categories', {
        method: 'POST',
        body: {
          slug: input.slug,
          name: input.name,
          description: input.description || null,
          seo_title: input.seoTitle || null,
          seo_description: input.seoDescription || null,
          sort_order: input.sortOrder,
          noindex: input.noindex,
        },
      })
      return mapCategory(row)
    }
    const store = readLocal()
    const category: ContentCategory = { ...input, id: localId('cat') }
    store.categories.push(category)
    writeLocal(store)
    return category
  },

  async updateCategory(id: string, input: Partial<ContentCategory>): Promise<ContentCategory> {
    if (isApi()) {
      const row = await apiClient.request<ApiCategory>(`/admin/blog/categories/${id}`, {
        method: 'PUT',
        body: {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          seo_title: input.seoTitle ?? null,
          seo_description: input.seoDescription ?? null,
          sort_order: input.sortOrder,
          noindex: input.noindex,
        },
      })
      return mapCategory({ ...row, id: Number(id) })
    }
    const store = readLocal()
    const index = store.categories.findIndex((category) => category.id === id)
    if (index === -1) throw new Error('Category not found.')
    store.categories[index] = { ...store.categories[index], ...input }
    writeLocal(store)
    return store.categories[index]
  },

  async deleteCategory(id: string): Promise<void> {
    if (isApi()) {
      await apiClient.request<void>(`/admin/blog/categories/${id}`, { method: 'DELETE' })
      return
    }
    const store = readLocal()
    if (store.posts.some((post) => post.categoryId === id)) {
      throw new Error('Move the posts in this category first.')
    }
    store.categories = store.categories.filter((category) => category.id !== id)
    writeLocal(store)
  },

  /* -------------------------------- tags -------------------------------- */

  async listTags(): Promise<ContentTag[]> {
    if (isApi()) {
      const rows = await apiClient.request<ApiTag[]>('/admin/blog/tags')
      return rows.map(mapTag)
    }
    return readLocal().tags
  },

  async createTag(name: string): Promise<ContentTag> {
    const slug = slugify(name)
    if (isApi()) {
      const row = await apiClient.request<ApiTag>('/admin/blog/tags', { method: 'POST', body: { slug, name } })
      return mapTag(row)
    }
    const store = readLocal()
    const existing = store.tags.find((tag) => tag.slug === slug)
    if (existing) return existing
    const tag: ContentTag = { id: localId('tag'), slug, name }
    store.tags.push(tag)
    writeLocal(store)
    return tag
  },

  async deleteTag(id: string): Promise<void> {
    if (isApi()) {
      await apiClient.request<void>(`/admin/blog/tags/${id}`, { method: 'DELETE' })
      return
    }
    const store = readLocal()
    store.tags = store.tags.filter((tag) => tag.id !== id)
    store.posts = store.posts.map((post) => ({ ...post, tags: post.tags.filter((tag) => tag.id !== id) }))
    writeLocal(store)
  },

  /* -------------------------------- posts ------------------------------- */

  async listPosts(filters: { status?: string; category?: string; q?: string; page?: number; perPage?: number } = {}): Promise<ListResult<ContentPost>> {
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 50

    if (isApi()) {
      const envelope = await apiClient.envelope<ApiPost[]>('/admin/blog', {
        query: {
          page,
          per_page: perPage,
          status: filters.status || undefined,
          category: filters.category && filters.category !== 'all' ? filters.category : undefined,
          q: filters.q || undefined,
        },
      })
      return {
        items: envelope.data.map(mapPost),
        total: metaNumber(envelope.meta, 'total', envelope.data.length),
        page: metaNumber(envelope.meta, 'page', page),
        perPage: metaNumber(envelope.meta, 'per_page', perPage),
      }
    }

    const store = readLocal()
    let items = [...store.posts]
    if (filters.status && filters.status !== 'all') items = items.filter((post) => post.status === filters.status)
    if (filters.category && filters.category !== 'all') items = items.filter((post) => post.categoryId === filters.category)
    if (filters.q) {
      const needle = filters.q.toLowerCase()
      items = items.filter((post) => `${post.title} ${post.slug} ${post.excerpt}`.toLowerCase().includes(needle))
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { items, total: items.length, page: 1, perPage: items.length }
  },

  async getPost(id: string): Promise<ContentPost> {
    if (isApi()) {
      return mapPost(await apiClient.request<ApiPost>(`/admin/blog/${id}`))
    }
    const post = readLocal().posts.find((item) => item.id === id)
    if (!post) throw new Error('Post not found.')
    return post
  },

  async createPost(input: PostInput): Promise<ContentPost> {
    if (isApi()) {
      return mapPost(await apiClient.request<ApiPost>('/admin/blog', { method: 'POST', body: postPayload(input) }))
    }
    const store = readLocal()
    const category = store.categories.find((item) => item.id === input.categoryId)
    const post: ContentPost = {
      id: localId('post'),
      slug: input.slug,
      title: input.title,
      categoryId: input.categoryId,
      categoryName: category?.name ?? '',
      status: input.status,
      excerpt: input.excerpt,
      body: input.body,
      featuredImage: input.featuredImage,
      featuredImageAlt: input.featuredImageAlt,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      seoSummary: input.seoSummary,
      focusKeyword: input.focusKeyword,
      secondaryKeywords: input.secondaryKeywords,
      canonicalUrl: input.canonicalUrl,
      noindex: input.noindex,
      socialImage: input.socialImage,
      author: input.author,
      publishedAt: input.publishedAt || (input.status === 'published' ? new Date().toISOString() : ''),
      scheduledAt: input.scheduledAt,
      updatedAt: new Date().toISOString(),
      readTimeMinutes: readingMinutes(input.body),
      viewCount: 0,
      tags: store.tags.filter((tag) => input.tagIds.includes(tag.id)),
      metadata: input.metadata,
    }
    store.posts.push(post)
    writeLocal(store)
    return post
  },

  async updatePost(id: string, input: PostInput): Promise<ContentPost> {
    if (isApi()) {
      return mapPost(await apiClient.request<ApiPost>(`/admin/blog/${id}`, { method: 'PUT', body: postPayload(input) }))
    }
    const store = readLocal()
    const index = store.posts.findIndex((post) => post.id === id)
    if (index === -1) throw new Error('Post not found.')
    const category = store.categories.find((item) => item.id === input.categoryId)
    const previous = store.posts[index]
    store.posts[index] = {
      ...previous,
      ...input,
      categoryName: category?.name ?? '',
      tags: store.tags.filter((tag) => input.tagIds.includes(tag.id)),
      updatedAt: new Date().toISOString(),
      readTimeMinutes: readingMinutes(input.body),
      viewCount: previous.viewCount,
    }
    writeLocal(store)
    return store.posts[index]
  },

  async deletePost(id: string): Promise<void> {
    if (isApi()) {
      await apiClient.request<void>(`/admin/blog/${id}`, { method: 'DELETE' })
      return
    }
    const store = readLocal()
    store.posts = store.posts.filter((post) => post.id !== id)
    writeLocal(store)
  },

  async setStatus(id: string, status: ContentStatus): Promise<void> {
    if (isApi()) {
      await apiClient.request<ApiPost>(`/admin/blog/${id}/${status === 'published' ? 'publish' : 'unpublish'}`, {
        method: 'POST',
        body: {},
      })
      return
    }
    const store = readLocal()
    store.posts = store.posts.map((post) =>
      post.id === id
        ? {
            ...post,
            status,
            publishedAt: status === 'published' ? new Date().toISOString() : post.publishedAt,
            scheduledAt: status === 'scheduled' ? post.scheduledAt : '',
            updatedAt: new Date().toISOString(),
          }
        : post,
    )
    writeLocal(store)
  },

  /* -------------------------------- pages ------------------------------- */

  async listPages(filters: { status?: string; q?: string } = {}): Promise<ListResult<ContentPage>> {
    if (isApi()) {
      const envelope = await apiClient.envelope<ApiPage[]>('/admin/pages', {
        query: { per_page: 100, status: filters.status || undefined, q: filters.q || undefined },
      })
      return {
        items: envelope.data.map(mapPage),
        total: metaNumber(envelope.meta, 'total', envelope.data.length),
        page: 1,
        perPage: envelope.data.length,
      }
    }
    const store = readLocal()
    let items = [...store.pages]
    if (filters.status && filters.status !== 'all') items = items.filter((page) => page.status === filters.status)
    if (filters.q) {
      const needle = filters.q.toLowerCase()
      items = items.filter((page) => `${page.title} ${page.slug}`.toLowerCase().includes(needle))
    }
    return { items, total: items.length, page: 1, perPage: items.length }
  },

  async getPage(id: string): Promise<ContentPage> {
    if (isApi()) return mapPage(await apiClient.request<ApiPage>(`/admin/pages/${id}`))
    const page = readLocal().pages.find((item) => item.id === id)
    if (!page) throw new Error('Page not found.')
    return page
  },

  async createPage(input: PageInput): Promise<ContentPage> {
    if (isApi()) {
      return mapPage(await apiClient.request<ApiPage>('/admin/pages', { method: 'POST', body: pagePayload(input) }))
    }
    const store = readLocal()
    const page: ContentPage = {
      ...input,
      excerpt: input.excerpt,
      id: localId('page'),
      publishedAt: input.status === 'published' ? new Date().toISOString() : '',
      updatedAt: new Date().toISOString(),
    }
    store.pages.push(page)
    writeLocal(store)
    return page
  },

  async updatePage(id: string, input: PageInput): Promise<ContentPage> {
    if (isApi()) {
      return mapPage(await apiClient.request<ApiPage>(`/admin/pages/${id}`, { method: 'PUT', body: pagePayload(input) }))
    }
    const store = readLocal()
    const index = store.pages.findIndex((page) => page.id === id)
    if (index === -1) throw new Error('Page not found.')
    store.pages[index] = { ...store.pages[index], ...input, updatedAt: new Date().toISOString() }
    writeLocal(store)
    return store.pages[index]
  },

  async deletePage(id: string): Promise<void> {
    if (isApi()) {
      await apiClient.request<void>(`/admin/pages/${id}`, { method: 'DELETE' })
      return
    }
    const store = readLocal()
    store.pages = store.pages.filter((page) => page.id !== id)
    writeLocal(store)
  },

  /* -------------------------------- media ------------------------------- */

  async listMedia(page = 1, perPage = 48): Promise<ListResult<MediaAsset>> {
    if (isApi()) {
      const envelope = await apiClient.envelope<Array<{
        id: number
        filename: string
        path: string
        mime_type: string
        alt_text?: string | null
        size_bytes?: number
      }>>('/admin/media', { query: { page, per_page: perPage } })
      return {
        items: envelope.data.map((item) => ({
          id: String(item.id),
          filename: item.filename,
          path: item.path,
          mimeType: item.mime_type,
          altText: item.alt_text ?? '',
          sizeBytes: Number(item.size_bytes ?? 0),
        })),
        total: metaNumber(envelope.meta, 'total', envelope.data.length),
        page,
        perPage,
      }
    }
    const store = readLocal()
    const items = [...store.posts, ...store.pages]
      .map((item) => ('featuredImage' in item ? item.featuredImage : item.ogImage))
      .filter(Boolean)
      .map((path, index) => ({
        id: `local-${index}`,
        filename: path.split('/').pop() ?? path,
        path,
        mimeType: 'image/svg+xml',
        altText: '',
        sizeBytes: 0,
      }))
    return { items, total: items.length, page: 1, perPage: items.length }
  },

  async uploadMedia(file: File, altText = ''): Promise<MediaAsset> {
    if (!isApi()) throw new Error('Uploads need the API. Set VITE_API_BASE_URL to enable them.')
    const form = new FormData()
    form.append('file', file)
    if (altText) form.append('alt_text', altText)

    const created = await apiClient.request<{
      id: number
      filename: string
      path: string
      mime_type: string
      alt_text?: string | null
      size_bytes?: number
    }>('/admin/media', { method: 'POST', body: form })

    return {
      id: String(created.id),
      filename: created.filename,
      path: created.path,
      mimeType: created.mime_type,
      altText: created.alt_text ?? altText,
      sizeBytes: Number(created.size_bytes ?? file.size),
    }
  },

  /* ----------------------------- publishing ----------------------------- */

  async runScheduler(): Promise<{ published: Array<{ type: string; id: number; title: string }>; failed: unknown[]; checked: number }> {
    if (!isApi()) return { published: [], failed: [], checked: 0 }
    return apiClient.request('/admin/publishing/run', { method: 'POST', body: {} })
  },

  async publishingLog(limit = 40): Promise<Array<{
    id: number
    entity_type: string
    entity_id: number
    action: string
    scheduled_for: string | null
    executed_at: string
    actor: string
    message: string | null
  }>> {
    if (!isApi()) return []
    return apiClient.request('/admin/publishing/log', { query: { limit } })
  },

  async sitemapStatus(): Promise<{ path: string; last_updated: string | null; urls: number; base_url: string } | null> {
    if (!isApi()) return null
    return apiClient.request('/admin/publishing/sitemap')
  },

  async rebuildSitemap(): Promise<{ bytes: number; urls: number; last_updated: string | null }> {
    if (!isApi()) return { bytes: 0, urls: 0, last_updated: null }
    return apiClient.request('/admin/publishing/sitemap', { method: 'POST', body: {} })
  },
}

/** Converts a stored post into the editable form shape. */
export const postToInput = (post: ContentPost): PostInput => ({
  title: post.title,
  slug: post.slug,
  categoryId: post.categoryId,
  status: post.status,
  excerpt: post.excerpt,
  body: post.body,
  featuredImage: post.featuredImage,
  featuredImageAlt: post.featuredImageAlt,
  seoTitle: post.seoTitle,
  seoDescription: post.seoDescription,
  seoSummary: post.seoSummary,
  focusKeyword: post.focusKeyword,
  secondaryKeywords: post.secondaryKeywords,
  canonicalUrl: post.canonicalUrl,
  noindex: post.noindex,
  socialImage: post.socialImage,
  author: post.author,
  publishedAt: post.publishedAt,
  scheduledAt: post.scheduledAt,
  tagIds: post.tags.map((tag) => tag.id),
  metadata: post.metadata,
})

export const pageToInput = (page: ContentPage): PageInput => ({
  title: page.title,
  slug: page.slug,
  template: page.template,
  status: page.status,
  excerpt: page.excerpt,
  body: page.body,
  seoTitle: page.seoTitle,
  seoDescription: page.seoDescription,
  focusKeyword: page.focusKeyword,
  secondaryKeywords: page.secondaryKeywords,
  canonicalUrl: page.canonicalUrl,
  noindex: page.noindex,
  ogImage: page.ogImage,
  pageGroup: page.pageGroup,
  sortOrder: page.sortOrder,
  scheduledAt: page.scheduledAt,
})
