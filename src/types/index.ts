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
