/**
 * Admin data models.
 *
 * These mirror the shapes Phase 2 will expose over the PHP REST API, so the UI
 * can be switched from the local mock repository to the real API without
 * touching a single component. Keep field names stable once Phase 2 starts.
 */

/* -------------------------------------------------------------------------- */
/*  Authentication                                                            */
/* -------------------------------------------------------------------------- */

export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  initials: string
}

export interface AdminSession {
  token: string
  user: AdminUser
  issuedAt: string
  expiresAt: string
}

export interface AdminCredentials {
  email: string
  password: string
}

/* -------------------------------------------------------------------------- */
/*  Directory: services, niches and tracking numbers                          */
/* -------------------------------------------------------------------------- */

export type ServiceStatus = 'published' | 'draft'

export interface ServiceRecord {
  id: string
  slug: string
  name: string
  /** Phone-directory group this service draws its numbers from. */
  groupId: string | null
  nicheId: string | null
  category: string
  icon: string
  featured: boolean
  status: ServiceStatus
  sortOrder: number
  shortDescription: string
  metaTitle: string
  metaDescription: string
  updatedAt: string
}

export type PhoneStatus = 'active' | 'pending-verification' | 'inactive'

export interface TrackingNumber {
  id: string
  /** Directory group the number belongs to (matches src/data/serviceNumbers.ts). */
  groupId: string
  number: string
  /** Human description shown in the admin table. */
  label: string
  /** 1 = "Call Now" primary, 2+ = alternates, ascending. */
  priority: number
  status: PhoneStatus
  /** Call network / vendor that owns the line. */
  network: string
  /** Campaign or tracking pool name. */
  campaign: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type NicheStatus = 'active' | 'paused'

export interface NicheRecord {
  id: string
  name: string
  slug: string
  description: string
  /** Tailwind-friendly tone used by the admin badges. */
  tone: 'brand' | 'success' | 'amber' | 'slate' | 'violet' | 'rose'
  status: NicheStatus
  createdAt: string
}

/* -------------------------------------------------------------------------- */
/*  Content                                                                   */
/* -------------------------------------------------------------------------- */

export type ContentStatus = 'published' | 'draft' | 'scheduled'

export interface PageRecord {
  id: string
  title: string
  slug: string
  template: 'standard' | 'legal' | 'landing'
  status: ContentStatus
  excerpt: string
  seoTitle: string
  seoDescription: string
  updatedAt: string
  updatedBy: string
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  category: string
  status: ContentStatus
  excerpt: string
  featuredImage: string
  seoTitle: string
  seoDescription: string
  author: string
  publishedAt: string
  updatedAt: string
}

export interface HomepageSection {
  id: string
  key: string
  name: string
  heading: string
  subheading: string
  visible: boolean
  sortOrder: number
}

/* -------------------------------------------------------------------------- */
/*  Leads / support                                                           */
/* -------------------------------------------------------------------------- */

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed'
export type LeadSource = 'Organic search' | 'Direct' | 'Social' | 'Referral' | 'Paid search'

export interface LeadRecord {
  id: string
  name: string
  email: string
  phone: string
  service: string
  message: string
  source: LeadSource
  status: LeadStatus
  priority: 'high' | 'normal' | 'low'
  assignedTo: string | null
  createdAt: string
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

export interface SiteSettings {
  siteName: string
  legalName: string
  domain: string
  supportEmail: string
  supportPhone: string
  addressLines: string[]
  hours: string
  timezone: string
  currency: string
  socials: { facebook: string; x: string; youtube: string }
  callTrackingEnabled: boolean
  leadNotifications: boolean
  maintenanceMode: boolean
  updatedAt: string
}

export interface SeoSettings {
  defaultTitle: string
  titleTemplate: string
  defaultDescription: string
  keywords: string[]
  robots: 'index,follow' | 'noindex,nofollow'
  sitemapEnabled: boolean
  canonicalBase: string
  ogImage: string
  googleVerification: string
  analyticsId: string
  updatedAt: string
}

/* -------------------------------------------------------------------------- */
/*  Activity                                                                  */
/* -------------------------------------------------------------------------- */

export interface ActivityEntry {
  id: string
  actor: string
  action: string
  target: string
  at: string
}

/* -------------------------------------------------------------------------- */
/*  Analytics (simulated)                                                     */
/* -------------------------------------------------------------------------- */

export interface DailyMetric {
  date: string
  visitors: number
  pageViews: number
  calls: number
  leads: number
  revenue: number
}

export interface SourceMetric {
  source: string
  visitors: number
  calls: number
  share: number
  tone: 'brand' | 'success' | 'amber' | 'violet' | 'slate'
}

export interface KeywordMetric {
  keyword: string
  clicks: number
  impressions: number
  position: number
  ctr: number
}

export interface LandingMetric {
  path: string
  title: string
  visitors: number
  calls: number
  conversion: number
}

export interface ServicePerformance {
  serviceId: string
  service: string
  groupId: string | null
  clicks: number
  calls: number
  leads: number
  conversion: number
}

export interface NumberPerformance {
  numberId: string
  number: string
  group: string
  calls: number
  connected: number
  durationMin: number
  status: PhoneStatus
}

export interface AnalyticsSnapshot {
  /** ISO timestamp of when the simulated dataset was generated. */
  generatedAt: string
  daily: DailyMetric[]
  sources: SourceMetric[]
  keywords: KeywordMetric[]
  landingPages: LandingMetric[]
  services: ServicePerformance[]
  numbers: NumberPerformance[]
  devices: { name: string; share: number }[]
  topStates: { state: string; calls: number; leads: number }[]
}

export interface MetricTotals {
  visitors: number
  pageViews: number
  calls: number
  leads: number
  revenue: number
  conversion: number
}

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminPreferences {
  sidebarCollapsed: boolean
  dashboardRange: number
}

export interface AdminWorkspace {
  version: number
  services: ServiceRecord[]
  numbers: TrackingNumber[]
  niches: NicheRecord[]
  pages: PageRecord[]
  posts: BlogPost[]
  sections: HomepageSection[]
  leads: LeadRecord[]
  settings: SiteSettings
  seo: SeoSettings
  activity: ActivityEntry[]
}

export interface ListParams {
  search?: string
  status?: string
  sort?: string
  direction?: 'asc' | 'desc'
}
