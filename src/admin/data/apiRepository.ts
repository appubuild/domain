/**
 * REST-backed implementation of `AdminRepository`.
 *
 * Selected automatically when `VITE_API_BASE_URL` is configured (see
 * `repository.ts`). Every method maps the API's snake_case payload onto the
 * admin's camelCase records, so the screens themselves never change.
 *
 * Notes:
 *  · a service is bound to its phone group through `service_phone_groups`; the
 *    admin UI edits one group, so `groupId` reads/writes the first mapping;
 *  · the API is the authority for validation — its 422 field errors are surfaced
 *    to the forms through `ApiError.fields`;
 *  · `resetDemoData` only exists in demo mode (there is nothing to reset server-
 *    side), so it fails loudly instead of pretending to work.
 */
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import type {
  ActivityEntry,
  AdminWorkspace,
  BlogPost,
  HomepageSection,
  LeadRecord,
  NicheRecord,
  PageRecord,
  SeoSettings,
  ServiceRecord,
  SiteSettings,
  TrackingNumber,
} from '@/admin/types/admin'
import { apiClient } from './apiClient'
import type { AdminRepository, NewNiche, NewNumber, NewPage, NewPost, NewService } from './repository'
import { DEMO_WORKSPACE_VERSION } from './seed'

const { endpoints, version } = ADMIN_CONFIG.api

/* -------------------------------------------------------------------------- */
/*  Wire types                                                                */
/* -------------------------------------------------------------------------- */

interface ApiService {
  id: number
  slug: string
  name: string
  short_name: string | null
  category_id: string | null
  niche_id: number | null
  icon: string
  featured: boolean
  status: 'published' | 'draft'
  sort_order: number
  short_description: string | null
  meta_title: string | null
  meta_description: string | null
  updated_at: string
  phone_group_ids?: string[]
}

interface ApiNumber {
  id: number
  external_id: string
  group_id: string
  number: string
  label: string | null
  priority: number
  status: 'active' | 'pending-verification' | 'inactive'
  network: string | null
  campaign: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ApiNiche {
  id: number
  slug: string
  name: string
  description: string | null
  tone: string
  status: 'active' | 'paused'
  created_at: string
}

interface ApiPage {
  id: number
  slug: string
  title: string
  template: 'standard' | 'legal' | 'landing'
  status: 'published' | 'draft' | 'scheduled'
  excerpt: string | null
  seo_title: string | null
  seo_description: string | null
  updated_at: string
  updated_by_name: string | null
}

interface ApiPost {
  id: number
  slug: string
  title: string
  category_name: string | null
  status: 'published' | 'draft' | 'scheduled'
  excerpt: string | null
  featured_image: string | null
  seo_title: string | null
  seo_description: string | null
  author: string
  published_at: string | null
  updated_at: string
}

interface ApiSection {
  id: number
  section_key: string
  name: string
  heading: string | null
  subheading: string | null
  visible: boolean
  sort_order: number
}

interface ApiLead {
  id: number
  name: string
  email: string
  phone: string | null
  service: string | null
  message: string
  source: string
  status: 'new' | 'contacted' | 'qualified' | 'closed'
  priority: 'high' | 'normal' | 'low'
  assigned_name: string | null
  created_at: string
}

interface ApiSettingEntry {
  key: string
  value: unknown
  type: string
  updated_at: string
}

interface ApiSettingGroup {
  groups: Record<string, ApiSettingEntry[]>
}

interface ApiSeo {
  default_title: string
  title_template: string
  default_description: string
  keywords: string[]
  robots: string
  sitemap_enabled: boolean
  canonical_base: string
  og_image: string | null
  google_verification: string | null
  analytics_id: string | null
  updated_at: string
}

interface ApiActivity {
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string | null
  created_at: string
  admin_name: string | null
}

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                   */
/* -------------------------------------------------------------------------- */

const mapService = (service: ApiService): ServiceRecord => ({
  id: String(service.id),
  slug: service.slug,
  name: service.name,
  groupId: service.phone_group_ids?.[0] ?? null,
  nicheId: service.niche_id === null ? null : String(service.niche_id),
  category: service.category_id ?? '',
  icon: service.icon,
  featured: service.featured,
  status: service.status,
  sortOrder: service.sort_order,
  shortDescription: service.short_description ?? '',
  metaTitle: service.meta_title ?? '',
  metaDescription: service.meta_description ?? '',
  updatedAt: service.updated_at,
})

const servicePayload = (input: Partial<NewService>): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}

  if (input.slug !== undefined) payload.slug = input.slug
  if (input.name !== undefined) payload.name = input.name
  if (input.category !== undefined) payload.category_id = input.category || null
  if (input.icon !== undefined) payload.icon = input.icon
  if (input.featured !== undefined) payload.featured = input.featured
  if (input.status !== undefined) payload.status = input.status
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
  if (input.shortDescription !== undefined) payload.short_description = input.shortDescription
  if (input.metaTitle !== undefined) payload.meta_title = input.metaTitle
  if (input.metaDescription !== undefined) payload.meta_description = input.metaDescription
  if (input.nicheId !== undefined) payload.niche_id = input.nicheId ? Number(input.nicheId) : null
  if (input.groupId !== undefined) payload.phone_group_ids = input.groupId ? [input.groupId] : []

  return payload
}

const mapNumber = (number: ApiNumber): TrackingNumber => ({
  id: String(number.id),
  groupId: number.group_id,
  number: number.number,
  label: number.label ?? '',
  priority: number.priority,
  status: number.status,
  network: number.network ?? '',
  campaign: number.campaign ?? '',
  notes: number.notes ?? '',
  createdAt: number.created_at,
  updatedAt: number.updated_at,
})

const numberPayload = (input: Partial<NewNumber>): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}
  if (input.groupId !== undefined) payload.group_id = input.groupId
  if (input.number !== undefined) payload.number = input.number
  if (input.label !== undefined) payload.label = input.label
  if (input.priority !== undefined) payload.priority = input.priority
  if (input.status !== undefined) payload.status = input.status
  if (input.network !== undefined) payload.network = input.network
  if (input.campaign !== undefined) payload.campaign = input.campaign
  if (input.notes !== undefined) payload.notes = input.notes
  return payload
}

const mapNiche = (niche: ApiNiche): NicheRecord => ({
  id: String(niche.id),
  name: niche.name,
  slug: niche.slug,
  description: niche.description ?? '',
  tone: (['brand', 'success', 'amber', 'slate', 'violet', 'rose'].includes(niche.tone) ? niche.tone : 'brand') as NicheRecord['tone'],
  status: niche.status,
  createdAt: niche.created_at,
})

const mapPage = (page: ApiPage): PageRecord => ({
  id: String(page.id),
  title: page.title,
  slug: page.slug,
  template: page.template,
  status: page.status,
  excerpt: page.excerpt ?? '',
  seoTitle: page.seo_title ?? '',
  seoDescription: page.seo_description ?? '',
  updatedAt: page.updated_at,
  updatedBy: page.updated_by_name ?? 'Team',
})

const mapPost = (post: ApiPost): BlogPost => ({
  id: String(post.id),
  title: post.title,
  slug: post.slug,
  category: post.category_name ?? '',
  status: post.status,
  excerpt: post.excerpt ?? '',
  featuredImage: post.featured_image ?? '',
  seoTitle: post.seo_title ?? '',
  seoDescription: post.seo_description ?? '',
  author: post.author,
  publishedAt: post.published_at ?? post.updated_at,
  updatedAt: post.updated_at,
})

const mapSection = (section: ApiSection): HomepageSection => ({
  id: String(section.id),
  key: section.section_key,
  name: section.name,
  heading: section.heading ?? '',
  subheading: section.subheading ?? '',
  visible: section.visible,
  sortOrder: section.sort_order,
})

const mapLead = (lead: ApiLead): LeadRecord => ({
  id: String(lead.id),
  name: lead.name,
  email: lead.email,
  phone: lead.phone ?? '',
  service: lead.service ?? '',
  message: lead.message,
  source: (['Organic search', 'Direct', 'Social', 'Referral', 'Paid search'].includes(lead.source)
    ? lead.source
    : 'Direct') as LeadRecord['source'],
  status: lead.status,
  priority: lead.priority,
  assignedTo: lead.assigned_name,
  createdAt: lead.created_at,
})

const mapActivity = (entry: ApiActivity, index: number): ActivityEntry => ({
  id: `${entry.created_at}-${index}`,
  actor: entry.admin_name ?? 'System',
  action: entry.action.replace(/[._]/g, ' '),
  target: entry.summary ?? entry.entity_type ?? '',
  at: entry.created_at,
})

/* ----------------------------- settings / seo ----------------------------- */

const SETTING_TO_SITE: Record<string, keyof SiteSettings> = {
  site_name: 'siteName',
  legal_name: 'legalName',
  domain: 'domain',
  contact_email: 'supportEmail',
  contact_phone_display: 'supportPhone',
  support_hours: 'hours',
  timezone: 'timezone',
  currency: 'currency',
  call_tracking_enabled: 'callTrackingEnabled',
  lead_notifications: 'leadNotifications',
  maintenance_mode: 'maintenanceMode',
}

const flattenSettings = (payload: ApiSettingGroup): Record<string, unknown> => {
  const flat: Record<string, unknown> = {}
  Object.values(payload.groups ?? {}).forEach((entries) => {
    entries.forEach((entry) => {
      flat[entry.key] = entry.value
    })
  })
  return flat
}

const siteFromSettings = (flat: Record<string, unknown>, updatedAt: string): SiteSettings => {
  const text = (key: string): string => (typeof flat[key] === 'string' ? (flat[key] as string) : '')
  const flag = (key: string): boolean => flat[key] === true || flat[key] === '1'

  const settings: SiteSettings = {
    siteName: text('site_name'),
    legalName: text('legal_name'),
    domain: text('domain'),
    supportEmail: text('contact_email'),
    supportPhone: text('contact_phone_display'),
    addressLines: Array.isArray(flat.address_lines) ? (flat.address_lines as string[]) : [],
    hours: text('support_hours'),
    timezone: text('timezone') || 'America/New_York',
    currency: text('currency') || 'USD',
    socials: {
      facebook: text('social_facebook'),
      x: text('social_x'),
      youtube: text('social_youtube'),
    },
    callTrackingEnabled: flag('call_tracking_enabled'),
    leadNotifications: flag('lead_notifications'),
    maintenanceMode: flag('maintenance_mode'),
    updatedAt,
  }

  void SETTING_TO_SITE
  return settings
}

const siteToSettings = (patch: Partial<SiteSettings>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  const put = (key: string, value: unknown): void => {
    if (value !== undefined) out[key] = value
  }

  put('site_name', patch.siteName)
  put('legal_name', patch.legalName)
  put('domain', patch.domain)
  put('contact_email', patch.supportEmail)
  put('contact_phone_display', patch.supportPhone)
  if (patch.addressLines !== undefined) put('address_lines', patch.addressLines)
  put('support_hours', patch.hours)
  put('timezone', patch.timezone)
  put('currency', patch.currency)
  if (patch.socials) {
    put('social_facebook', patch.socials.facebook)
    put('social_x', patch.socials.x)
    put('social_youtube', patch.socials.youtube)
  }
  put('call_tracking_enabled', patch.callTrackingEnabled)
  put('lead_notifications', patch.leadNotifications)
  put('maintenance_mode', patch.maintenanceMode)

  return out
}

const seoFromApi = (seo: ApiSeo): SeoSettings => ({
  defaultTitle: seo.default_title,
  titleTemplate: seo.title_template,
  defaultDescription: seo.default_description,
  keywords: seo.keywords ?? [],
  robots: seo.robots === 'noindex,nofollow' ? 'noindex,nofollow' : 'index,follow',
  sitemapEnabled: seo.sitemap_enabled,
  canonicalBase: seo.canonical_base,
  ogImage: seo.og_image ?? '',
  googleVerification: seo.google_verification ?? '',
  analyticsId: seo.analytics_id ?? '',
  updatedAt: seo.updated_at,
})

const seoToApi = (patch: Partial<SeoSettings>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (patch.defaultTitle !== undefined) out.default_title = patch.defaultTitle
  if (patch.titleTemplate !== undefined) out.title_template = patch.titleTemplate
  if (patch.defaultDescription !== undefined) out.default_description = patch.defaultDescription
  if (patch.keywords !== undefined) out.keywords = patch.keywords
  if (patch.robots !== undefined) out.robots = patch.robots
  if (patch.sitemapEnabled !== undefined) out.sitemap_enabled = patch.sitemapEnabled
  if (patch.canonicalBase !== undefined) out.canonical_base = patch.canonicalBase
  if (patch.ogImage !== undefined) out.og_image = patch.ogImage
  if (patch.googleVerification !== undefined) out.google_verification = patch.googleVerification
  if (patch.analyticsId !== undefined) out.analytics_id = patch.analyticsId
  return out
}

/* -------------------------------------------------------------------------- */
/*  Repository                                                                */
/* -------------------------------------------------------------------------- */

const adminPath = (endpoint: string, suffix = ''): string => `${endpoint}${suffix}`

export const createApiRepository = (): AdminRepository => ({
  mode: 'api',

  async getWorkspace(): Promise<AdminWorkspace> {
    const query = { per_page: 100 }

    const [services, numbers, niches, pages, posts, sections, leads, settings, seo, activity] = await Promise.all([
      apiClient.request<ApiService[]>(adminPath(endpoints.services), { query }),
      apiClient.request<ApiNumber[]>(adminPath(endpoints.numbers), { query }),
      apiClient.request<ApiNiche[]>(adminPath(endpoints.niches), { query }),
      apiClient.request<ApiPage[]>(adminPath(endpoints.pages), { query }),
      apiClient.request<ApiPost[]>(adminPath(endpoints.posts), { query }),
      apiClient.request<ApiSection[]>(adminPath(endpoints.sections)),
      apiClient.request<ApiLead[]>(adminPath(endpoints.leads), { query }),
      apiClient.request<ApiSettingGroup>(adminPath(endpoints.settings)),
      apiClient.request<ApiSeo>(adminPath(endpoints.seo)),
      apiClient.request<ApiActivity[]>(adminPath(endpoints.activity), { query: { limit: 60 } }),
    ])

    const flatSettings = flattenSettings(settings)
    const updatedAt = Object.entries(flatSettings).length > 0 ? new Date().toISOString() : new Date().toISOString()

    return {
      version: DEMO_WORKSPACE_VERSION,
      services: services.map(mapService),
      numbers: numbers.map(mapNumber),
      niches: niches.map(mapNiche),
      pages: pages.map(mapPage),
      posts: posts.map(mapPost),
      sections: sections.map(mapSection),
      leads: leads.map(mapLead),
      settings: siteFromSettings(flatSettings, updatedAt),
      seo: seoFromApi(seo),
      activity: activity.map(mapActivity),
    }
  },

  async resetDemoData(): Promise<AdminWorkspace> {
    throw new Error('There is no demo dataset to reset while the API is connected.')
  },

  /* ----------------------------- services ------------------------------- */

  async listServices(): Promise<ServiceRecord[]> {
    const services = await apiClient.request<ApiService[]>(adminPath(endpoints.services), { query: { per_page: 100 } })
    return services.map(mapService)
  },

  async createService(input: NewService): Promise<ServiceRecord> {
    const created = await apiClient.request<ApiService>(adminPath(endpoints.services), {
      method: 'POST',
      body: servicePayload(input),
    })
    return mapService(created)
  },

  async updateService(id, patch): Promise<ServiceRecord> {
    const updated = await apiClient.request<ApiService>(adminPath(`${endpoints.services}/${id}`), {
      method: 'PUT',
      body: servicePayload(patch),
    })
    return mapService(updated)
  },

  async deleteService(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.services}/${id}`), { method: 'DELETE' })
  },

  /* ------------------------------ numbers ------------------------------- */

  async listNumbers(): Promise<TrackingNumber[]> {
    const numbers = await apiClient.request<ApiNumber[]>(adminPath(endpoints.numbers), { query: { per_page: 100 } })
    return numbers.map(mapNumber)
  },

  async createNumber(input: NewNumber): Promise<TrackingNumber> {
    const payload = { ...numberPayload(input), external_id: makeExternalId(input.groupId, input.number) }
    const created = await apiClient.request<ApiNumber>(adminPath(endpoints.numbers), { method: 'POST', body: payload })
    return mapNumber(created)
  },

  async updateNumber(id, patch): Promise<TrackingNumber> {
    const updated = await apiClient.request<ApiNumber>(adminPath(`${endpoints.numbers}/${id}`), {
      method: 'PUT',
      body: numberPayload(patch),
    })
    return mapNumber(updated)
  },

  async deleteNumber(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.numbers}/${id}`), { method: 'DELETE' })
  },

  /* ------------------------------- niches ------------------------------- */

  async listNiches(): Promise<NicheRecord[]> {
    const niches = await apiClient.request<ApiNiche[]>(adminPath(endpoints.niches), { query: { per_page: 100 } })
    return niches.map(mapNiche)
  },

  async createNiche(input: NewNiche): Promise<NicheRecord> {
    const created = await apiClient.request<ApiNiche>(adminPath(endpoints.niches), {
      method: 'POST',
      body: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        tone: input.tone,
        status: input.status,
      },
    })
    return mapNiche(created)
  },

  async updateNiche(id, patch): Promise<NicheRecord> {
    const body: Record<string, unknown> = {}
    if (patch.slug !== undefined) body.slug = patch.slug
    if (patch.name !== undefined) body.name = patch.name
    if (patch.description !== undefined) body.description = patch.description
    if (patch.tone !== undefined) body.tone = patch.tone
    if (patch.status !== undefined) body.status = patch.status

    const updated = await apiClient.request<ApiNiche>(adminPath(`${endpoints.niches}/${id}`), { method: 'PUT', body })
    return mapNiche(updated)
  },

  async deleteNiche(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.niches}/${id}`), { method: 'DELETE' })
  },

  /* -------------------------------- pages ------------------------------- */

  async listPages(): Promise<PageRecord[]> {
    const pages = await apiClient.request<ApiPage[]>(adminPath(endpoints.pages), { query: { per_page: 100 } })
    return pages.map(mapPage)
  },

  async createPage(input: NewPage): Promise<PageRecord> {
    const created = await apiClient.request<ApiPage>(adminPath(endpoints.pages), {
      method: 'POST',
      body: {
        slug: input.slug.startsWith('/') ? input.slug : `/${input.slug}`,
        title: input.title,
        template: input.template,
        status: input.status,
        excerpt: input.excerpt,
        seo_title: input.seoTitle,
        seo_description: input.seoDescription,
      },
    })
    return mapPage(created)
  },

  async updatePage(id, patch): Promise<PageRecord> {
    const body: Record<string, unknown> = {}
    if (patch.slug !== undefined) body.slug = patch.slug
    if (patch.title !== undefined) body.title = patch.title
    if (patch.template !== undefined) body.template = patch.template
    if (patch.status !== undefined) body.status = patch.status
    if (patch.excerpt !== undefined) body.excerpt = patch.excerpt
    if (patch.seoTitle !== undefined) body.seo_title = patch.seoTitle
    if (patch.seoDescription !== undefined) body.seo_description = patch.seoDescription

    const updated = await apiClient.request<ApiPage>(adminPath(`${endpoints.pages}/${id}`), { method: 'PUT', body })
    return mapPage(updated)
  },

  async deletePage(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.pages}/${id}`), { method: 'DELETE' })
  },

  /* -------------------------------- posts ------------------------------- */

  async listPosts(): Promise<BlogPost[]> {
    const posts = await apiClient.request<ApiPost[]>(adminPath(endpoints.posts), { query: { per_page: 100 } })
    return posts.map(mapPost)
  },

  async createPost(input: NewPost): Promise<BlogPost> {
    const created = await apiClient.request<ApiPost>(adminPath(endpoints.posts), {
      method: 'POST',
      body: {
        slug: input.slug,
        title: input.title,
        status: input.status,
        excerpt: input.excerpt,
        featured_image: input.featuredImage,
        seo_title: input.seoTitle,
        seo_description: input.seoDescription,
        author_name: input.author,
        published_at: input.publishedAt || null,
      },
    })
    return mapPost(created)
  },

  async updatePost(id, patch): Promise<BlogPost> {
    const body: Record<string, unknown> = {}
    if (patch.slug !== undefined) body.slug = patch.slug
    if (patch.title !== undefined) body.title = patch.title
    if (patch.status !== undefined) body.status = patch.status
    if (patch.excerpt !== undefined) body.excerpt = patch.excerpt
    if (patch.featuredImage !== undefined) body.featured_image = patch.featuredImage
    if (patch.seoTitle !== undefined) body.seo_title = patch.seoTitle
    if (patch.seoDescription !== undefined) body.seo_description = patch.seoDescription
    if (patch.author !== undefined) body.author_name = patch.author
    if (patch.publishedAt !== undefined) body.published_at = patch.publishedAt || null

    const updated = await apiClient.request<ApiPost>(adminPath(`${endpoints.posts}/${id}`), { method: 'PUT', body })
    return mapPost(updated)
  },

  async deletePost(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.posts}/${id}`), { method: 'DELETE' })
  },

  /* ------------------------------ sections ------------------------------ */

  async listSections(): Promise<HomepageSection[]> {
    const sections = await apiClient.request<ApiSection[]>(adminPath(endpoints.sections))
    return sections.map(mapSection)
  },

  async updateSection(id, patch): Promise<HomepageSection> {
    const body: Record<string, unknown> = {}
    if (patch.name !== undefined) body.name = patch.name
    if (patch.heading !== undefined) body.heading = patch.heading
    if (patch.subheading !== undefined) body.subheading = patch.subheading
    if (patch.visible !== undefined) body.visible = patch.visible
    if (patch.sortOrder !== undefined) body.sort_order = patch.sortOrder

    const updated = await apiClient.request<ApiSection>(adminPath(`${endpoints.sections}/${id}`), { method: 'PUT', body })
    return mapSection(updated)
  },

  async moveSection(id, direction): Promise<HomepageSection[]> {
    const sections = await this.listSections()
    const index = sections.findIndex((section) => section.id === id)
    const swapWith = direction === 'up' ? index - 1 : index + 1

    if (index === -1 || swapWith < 0 || swapWith >= sections.length) return sections

    const reordered = [...sections]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(swapWith, 0, moved)

    const updated = await apiClient.request<ApiSection[]>(adminPath(`${endpoints.sections}/order`), {
      method: 'PUT',
      body: { order: reordered.map((section) => Number(section.id)) },
    })

    return updated.map(mapSection)
  },

  async createSection(input): Promise<HomepageSection> {
    const created = await apiClient.request<ApiSection>(adminPath(endpoints.sections), {
      method: 'POST',
      body: {
        section_key: input.key,
        name: input.name,
        heading: input.heading,
        subheading: input.subheading,
        visible: input.visible,
        sort_order: input.sortOrder,
      },
    })
    return mapSection(created)
  },

  async deleteSection(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.sections}/${id}`), { method: 'DELETE' })
  },

  /* -------------------------------- leads ------------------------------- */

  async listLeads(): Promise<LeadRecord[]> {
    const leads = await apiClient.request<ApiLead[]>(adminPath(endpoints.leads), { query: { per_page: 100 } })
    return leads.map(mapLead)
  },

  async updateLead(id, patch): Promise<LeadRecord> {
    const body: Record<string, unknown> = {}
    if (patch.status !== undefined) body.status = patch.status
    if (patch.priority !== undefined) body.priority = patch.priority

    const updated = await apiClient.request<ApiLead>(adminPath(`${endpoints.leads}/${id}`), { method: 'PUT', body })
    return mapLead(updated)
  },

  async deleteLead(id): Promise<void> {
    await apiClient.request<void>(adminPath(`${endpoints.leads}/${id}`), { method: 'DELETE' })
  },

  /* ------------------------------ settings ------------------------------ */

  async getSettings(): Promise<SiteSettings> {
    const payload = await apiClient.request<ApiSettingGroup>(adminPath(endpoints.settings))
    return siteFromSettings(flattenSettings(payload), new Date().toISOString())
  },

  async updateSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
    await apiClient.request(adminPath(endpoints.settings), {
      method: 'PUT',
      body: { settings: siteToSettings(patch) },
    })
    return this.getSettings()
  },

  async getSeo(): Promise<SeoSettings> {
    const seo = await apiClient.request<ApiSeo>(adminPath(endpoints.seo))
    return seoFromApi(seo)
  },

  async updateSeo(patch: Partial<SeoSettings>): Promise<SeoSettings> {
    const updated = await apiClient.request<ApiSeo>(adminPath(endpoints.seo), {
      method: 'PUT',
      body: seoToApi(patch),
    })
    return seoFromApi(updated)
  },

  /* ------------------------------- activity ----------------------------- */

  async listActivity(): Promise<ActivityEntry[]> {
    const entries = await apiClient.request<ApiActivity[]>(adminPath(endpoints.activity), { query: { limit: 40 } })
    return entries.map(mapActivity)
  },

  async logActivity(): Promise<void> {
    // The API writes its own audit trail for every mutation.
    return Promise.resolve()
  },
})

/** External id is required by the API and must be stable and unique. */
const makeExternalId = (groupId: string, number: string): string => {
  const digits = number.replace(/\D/g, '').slice(-4)
  const base = `${groupId}-${digits}`.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return `${base}-${Date.now().toString(36).slice(-4)}`
}

export const API_REPOSITORY_VERSION = version
