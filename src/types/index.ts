/**
 * Shared content + configuration types.
 * Everything here is consumed by UI components — no component should hard-code
 * business data such as phone numbers, ZIP coverage, or service lists.
 */

export type ServiceCategoryId =
  | 'exterior'
  | 'systems'
  | 'remodeling'
  | 'restoration'
  | 'specialty'

export interface ServiceCategory {
  id: ServiceCategoryId
  name: string
  description: string
}

export interface ContentBlock {
  title: string
  description: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface Service {
  /** URL segment — /services/{slug} */
  slug: string
  name: string
  /** Shorter label for dense UI (cards, chips, breadcrumbs). Defaults to name. */
  shortName?: string
  category: ServiceCategoryId
  /** Key into the shared Lucide icon map. */
  icon: string
  image: string
  featured: boolean
  heroHeadline: string
  heroSubheadline: string
  shortDescription: string
  intro: string[]
  commonNeeds: ContentBlock[]
  options: ContentBlock[]
  /** Service-specific sentence explaining the connection model. */
  processNote: string
  faqs: FaqItem[]
  related: string[]
  metaTitle: string
  metaDescription: string
  /** Extra keywords used by the directory search box. */
  searchTerms?: string[]
}

export type CoverageStatus = 'available' | 'unavailable' | 'unverified'

export interface CoverageRecord {
  serviceSlug: string
  /** True only once coverage has been confirmed with real provider data. */
  verified: boolean
  /** Full 5-digit ZIP codes that are explicitly covered. */
  zips?: string[]
  /** 3-digit ZIP prefixes, useful when a whole metro area is covered. */
  zipPrefixes?: string[]
  /** Human-readable note shown in the result panel. */
  note?: string
  lastReviewed?: string
}

export interface Provider {
  id: string
  name: string
  serviceSlugs: string[]
  /** E.164 or dialable US number. Leave null until an authorized number exists. */
  phone: string | null
  /** Authorized tracking number (CallRail / Ringba / MarketCall), if different. */
  trackingNumber?: string | null
  availability: 'available' | 'limited' | 'unavailable'
  /** ZIP codes this provider covers. */
  coverageZips?: string[]
  coverageZipPrefixes?: string[]
  /** Required disclosure copy shown next to the contact option. */
  disclosure: string
  /** Optional licensed-credential note supplied by the provider. */
  credentialNote?: string
  website?: string
}

export interface AvailabilityResult {
  zip: string
  serviceSlug: string
  serviceName: string
  status: CoverageStatus
  /** Where the coverage answer came from — surfaced in the UI for transparency. */
  dataSource: 'configured' | 'example' | 'none'
  note?: string
  lastReviewed?: string
  providers: Provider[]
}
