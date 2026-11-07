/**
 * Public API reads and mappers.
 *
 * The API speaks snake_case (it mirrors the MySQL schema); the site's existing
 * components speak the camelCase types in `src/types`. All translation happens
 * here so no component needs to know about either convention.
 */
import type { ContentBlock, FaqItem, Service, ServiceCategory, ServiceCategoryId } from '@/types'
import type { ServicePhoneGroup, ServicePhoneNumber } from '@/data/serviceNumbers'
import type { CallDirectoryCategory, ServiceNumberMapping } from '@/data/serviceNumberMapping'
import type { NumberCampaign } from '@/data/serviceNumbers'
import { apiRequest } from './client'

/* -------------------------------------------------------------------------- */
/*  Wire types                                                                */
/* -------------------------------------------------------------------------- */

export interface ApiCategory {
  id: string
  name: string
  description: string | null
  sort_order: number
  service_count: number
}

export interface ApiPhoneNumber {
  id: number
  external_id: string
  number: string
  label: string | null
  priority: number
  priority_label: string
  tel: string
}

export interface ApiPhoneGroup {
  id: string
  name: string
  label: string | null
  blurb: string | null
  icon: string | null
  numbers: ApiPhoneNumber[]
}

export interface ApiServiceDetail {
  id: number
  slug: string
  name: string
  short_name: string | null
  category: { id: string; name: string } | null
  niche: { slug: string | null; name: string } | null
  icon: string
  image: string | null
  featured: boolean
  hero_headline: string | null
  hero_subheadline: string | null
  short_description: string | null
  intro: string[]
  common_needs: ContentBlock[]
  options: ContentBlock[]
  process_note: string | null
  faqs: FaqItem[]
  related: string[]
  search_terms: string[]
  meta_title: string | null
  meta_description: string | null
  updated_at: string
  phone_groups: ApiPhoneGroup[]
}

export interface ApiGroupIndexEntry {
  id: string
  name: string
  label: string | null
  blurb: string | null
  icon: string | null
  has_active_numbers: boolean
  active_number_count: number
}

export interface ApiFaqGroup {
  id: string
  name: string
  faqs: { id: number; question: string; answer: string }[]
}

export interface ApiIntegrations {
  analytics_id: string | null
  google_verification: string | null
  header_scripts: string | null
  footer_scripts: string | null
  scripts_valid: boolean
  maintenance_mode: boolean
  sitemap_enabled: boolean
}

export interface ApiPublicSeo {
  default_title: string
  title_template: string
  default_description: string
  robots: string
  canonical_base: string
  og_image: string | null
  sitemap_enabled: boolean
  keywords: string[]
}

/** A number the site is allowed to render, plus the ids needed for analytics. */
export interface LiveNumberRecord {
  id: number
  externalId: string
  serviceSlug: string
  groupId: string
}

export interface LiveDirectory {
  groups: ServicePhoneGroup[]
  mapping: Record<string, ServiceNumberMapping>
  directory: CallDirectoryCategory[]
  numberIndex: Record<string, LiveNumberRecord>
  /** Service slug → database id, used by the analytics events. */
  serviceIds: Record<string, number>
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                     */
/* -------------------------------------------------------------------------- */

export const fetchServiceDirectory = () =>
  apiRequest<{ services: ApiServiceDetail[]; categories: ApiCategory[] }>('/v1/services', {
    query: { full: 1 },
  })

export const fetchGroupIndex = () => apiRequest<ApiGroupIndexEntry[]>('/v1/phone-groups')

export const fetchPublicSettings = () => apiRequest<Record<string, unknown>>('/v1/settings')

export const fetchPublicFaqs = () => apiRequest<ApiFaqGroup[]>('/v1/faqs')

export const fetchIntegrations = () => apiRequest<ApiIntegrations>('/v1/integrations')

export const fetchPublicSeo = () => apiRequest<ApiPublicSeo>('/v1/seo')

/* -------------------------------------------------------------------------- */
/*  Mappers                                                                   */
/* -------------------------------------------------------------------------- */

const CATEGORY_IDS: ServiceCategoryId[] = ['exterior', 'systems', 'remodeling', 'restoration', 'specialty']

const asCategoryId = (value: string | undefined): ServiceCategoryId =>
  CATEGORY_IDS.includes(value as ServiceCategoryId) ? (value as ServiceCategoryId) : 'specialty'

const asBlocks = (blocks: ContentBlock[] | undefined): ContentBlock[] =>
  (blocks ?? [])
    .filter((block): block is ContentBlock => Boolean(block && block.title && block.description))
    .map((block) => ({ title: block.title, description: block.description }))

export const mapCategory = (category: ApiCategory): ServiceCategory => ({
  id: asCategoryId(category.id),
  name: category.name,
  description: category.description ?? '',
})

export const mapService = (service: ApiServiceDetail): Service => ({
  slug: service.slug,
  name: service.name,
  shortName: service.short_name ?? undefined,
  category: asCategoryId(service.category?.id),
  icon: service.icon || 'wrench',
  image: service.image ?? '/images/service-generic.jpg',
  featured: service.featured,
  heroHeadline: service.hero_headline ?? service.name,
  heroSubheadline: service.hero_subheadline ?? service.short_description ?? '',
  shortDescription: service.short_description ?? '',
  intro: service.intro ?? [],
  commonNeeds: asBlocks(service.common_needs),
  options: asBlocks(service.options),
  processNote: service.process_note ?? '',
  faqs: (service.faqs ?? []).filter((faq) => Boolean(faq?.question && faq?.answer)),
  related: service.related ?? [],
  metaTitle: service.meta_title ?? service.name,
  metaDescription: service.meta_description ?? service.short_description ?? '',
  searchTerms: service.search_terms ?? [],
})

/**
 * Builds the three structures the existing UI already reads:
 *  · phone groups (numbers per group)
 *  · service slug → group mapping
 *  · directory categories used by the homepage picker
 *
 * The API only returns numbers that are active AND mapped to the service, so
 * each number is marked nationwide here: publication has already been decided
 * server-side. Nothing is invented client-side.
 */
export const mapDirectory = (services: ApiServiceDetail[]): LiveDirectory => {
  const groupsById = new Map<string, ServicePhoneGroup>()
  const mapping: Record<string, ServiceNumberMapping> = {}
  const directory: CallDirectoryCategory[] = []
  const numberIndex: Record<string, LiveNumberRecord> = {}
  const serviceIds: Record<string, number> = {}

  services.forEach((service) => {
    const groupIds: string[] = []
    serviceIds[service.slug] = service.id

    service.phone_groups.forEach((group) => {
      groupIds.push(group.id)

      const numbers: ServicePhoneNumber[] = group.numbers.map((number) => {
        const digits = number.number.replace(/\D/g, '')
        numberIndex[digits] = {
          id: number.id,
          externalId: number.external_id,
          serviceSlug: service.slug,
          groupId: group.id,
        }
        const campaign: NumberCampaign = { nationwide: true }
        return {
          id: number.external_id,
          number: number.number,
          priority: number.priority,
          status: 'active',
          campaign,
        }
      })

      const existing = groupsById.get(group.id)
      if (existing) {
        existing.numbers = [...existing.numbers, ...numbers.filter((n) => !existing.numbers.some((e) => e.id === n.id))]
      } else {
        groupsById.set(group.id, { id: group.id, name: group.label ?? group.name, numbers })
      }

      if (!directory.some((entry) => entry.groupId === group.id)) {
        directory.push({
          groupId: group.id,
          label: group.label ?? group.name,
          blurb: group.blurb ?? '',
          icon: group.icon ?? 'wrench',
          serviceSlug: service.slug,
        })
      }
    })

    const primaryGroup = service.phone_groups[0]
    const labelBase = primaryGroup?.label ?? primaryGroup?.name ?? service.name
    mapping[service.slug] = {
      groupIds,
      label: /services$/i.test(labelBase) ? labelBase : `${labelBase} services`,
    }
  })

  return {
    groups: [...groupsById.values()],
    mapping,
    directory,
    numberIndex,
    serviceIds,
  }
}

/** Maps site settings (`settings` table) onto the existing SITE config shape. */
export const mapSettingsToSitePatch = (settings: Record<string, unknown>) => {
  const text = (key: string): string | undefined => {
    const value = settings[key]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }
  const addressLines = Array.isArray(settings.address_lines)
    ? (settings.address_lines as unknown[]).filter((line): line is string => typeof line === 'string')
    : undefined

  return {
    name: text('site_name'),
    shortName: text('site_short_name'),
    legalName: text('legal_name'),
    domain: text('domain'),
    url: text('site_url'),
    tagline: text('tagline'),
    description: text('description'),
    modelStatement: text('model_statement'),
    contact: {
      phone: text('contact_phone') ?? '',
      phoneDisplay: text('contact_phone_display') ?? '',
      email: text('contact_email'),
      supportHours: text('support_hours'),
      addressLines,
      responseTime: text('response_time'),
    },
    social: {
      facebook: text('social_facebook') ?? '',
      instagram: text('social_instagram') ?? '',
      linkedin: text('social_linkedin') ?? '',
      x: text('social_x') ?? '',
      youtube: text('social_youtube') ?? '',
    },
  }
}
