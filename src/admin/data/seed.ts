/**
 * Demo workspace seed.
 *
 * Services and tracking numbers are **derived from the live website data**
 * (`src/data/serviceNumbers.ts`, `src/data/serviceNumberMapping.ts` and
 * `src/config/services.ts`) so the admin panel starts in sync with the public
 * site — same groups, same numbers, same mapping. Content, leads and activity
 * entries are clearly fictional demo records.
 *
 * Resetting the demo data restores exactly this snapshot.
 */
import { SERVICES } from '@/config/services'
import { SITE } from '@/config/site'
import { SERVICE_NUMBER_MAP } from '@/data/serviceNumberMapping'
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import type {
  ActivityEntry,
  AdminWorkspace,
  BlogPost,
  HomepageSection,
  LeadRecord,
  NicheRecord,
  PageRecord,
  ServiceRecord,
  SeoSettings,
  SiteSettings,
  TrackingNumber,
} from '@/admin/types/admin'

const NOW = new Date('2026-11-07T09:00:00.000Z')

const iso = (daysAgo: number, hour = 9): string => {
  const date = new Date(NOW)
  date.setUTCDate(date.getUTCDate() - daysAgo)
  date.setUTCHours(hour, 0, 0, 0)
  return date.toISOString()
}

/* -------------------------------------------------------------------------- */
/*  Niches                                                                    */
/* -------------------------------------------------------------------------- */

const NICHES: NicheRecord[] = [
  {
    id: 'niche_property',
    name: 'Property & Exterior',
    slug: 'property-exterior',
    description: 'Roofing, windows, doors and hardscape — weather-facing work.',
    tone: 'brand',
    status: 'active',
    createdAt: iso(120),
  },
  {
    id: 'niche_systems',
    name: 'Home Systems',
    slug: 'home-systems',
    description: 'Plumbing, heating, cooling and electrical trades.',
    tone: 'success',
    status: 'active',
    createdAt: iso(120),
  },
  {
    id: 'niche_remodel',
    name: 'Remodeling',
    slug: 'remodeling',
    description: 'Kitchen, bathroom and bedroom renovation demand.',
    tone: 'violet',
    status: 'active',
    createdAt: iso(120),
  },
  {
    id: 'niche_restoration',
    name: 'Restoration & Emergency',
    slug: 'restoration-emergency',
    description: 'Water damage and storm response — highest time sensitivity.',
    tone: 'rose',
    status: 'active',
    createdAt: iso(110),
  },
  {
    id: 'niche_specialty',
    name: 'Specialty Trades',
    slug: 'specialty-trades',
    description: 'Pest control, locksmith and other single-trade niches.',
    tone: 'amber',
    status: 'active',
    createdAt: iso(110),
  },
  {
    id: 'niche_appliance',
    name: 'Appliance & Garage',
    slug: 'appliance-garage',
    description: 'Appliance repair, garage doors, gutters and tree work.',
    tone: 'slate',
    status: 'paused',
    createdAt: iso(95),
  },
]

const NICHE_BY_CATEGORY: Record<string, string> = {
  exterior: 'niche_property',
  systems: 'niche_systems',
  remodeling: 'niche_remodel',
  restoration: 'niche_restoration',
  specialty: 'niche_specialty',
}

/* -------------------------------------------------------------------------- */
/*  Services (mirrors the live website directory)                             */
/* -------------------------------------------------------------------------- */

const buildServices = (): ServiceRecord[] =>
  SERVICES.map((service, index) => ({
    id: `svc_${service.slug.replace(/-/g, '_')}`,
    slug: service.slug,
    name: service.name,
    groupId: SERVICE_NUMBER_MAP[service.slug]?.groupIds[0] ?? null,
    nicheId: NICHE_BY_CATEGORY[service.category] ?? null,
    category: service.category,
    icon: service.icon,
    featured: service.featured,
    status: 'published',
    sortOrder: index + 1,
    shortDescription: service.shortDescription,
    metaTitle: service.metaTitle,
    metaDescription: service.metaDescription,
    updatedAt: iso(3 + (index % 9)),
  }))

/* -------------------------------------------------------------------------- */
/*  Tracking numbers (mirrors the live phone directory)                       */
/* -------------------------------------------------------------------------- */

const buildNumbers = (): TrackingNumber[] =>
  SERVICE_PHONE_NUMBERS.flatMap((group) =>
    group.numbers.map((phone) => ({
      id: phone.id,
      groupId: group.id,
      number: phone.number,
      label: `${group.name} — ${phone.priority === 1 ? 'primary' : 'alternate'} line`,
      priority: phone.priority,
      status: phone.status,
      network: phone.campaign?.network ?? 'Owner-confirmed direct line',
      campaign: phone.campaign?.campaign ?? 'Nationwide (confirmed 2026-11-07)',
      notes: phone.campaign?.notes ?? '',
      createdAt: iso(120),
      updatedAt: iso(1),
    })),
  )

/* -------------------------------------------------------------------------- */
/*  Pages                                                                     */
/* -------------------------------------------------------------------------- */

const PAGES: Omit<PageRecord, 'updatedBy'>[] = [
  { id: 'page_home', title: 'Home', slug: '/', template: 'landing', status: 'published', excerpt: 'Hero, service picker, trust markers and popular categories.', seoTitle: 'Safe Home Network — Home Services, One Call Away', seoDescription: 'Pick a service and call the published line for that trade.', updatedAt: iso(1) },
  { id: 'page_about', title: 'About', slug: '/about', template: 'standard', status: 'published', excerpt: 'How the directory works and what we do not promise.', seoTitle: 'About Safe Home Network', seoDescription: 'A directory that connects homeowners with published service lines.', updatedAt: iso(4) },
  { id: 'page_services', title: 'Services', slug: '/services', template: 'standard', status: 'published', excerpt: 'All fifteen service categories with call buttons.', seoTitle: 'Home Service Categories', seoDescription: 'Browse every trade and call the line assigned to it.', updatedAt: iso(2) },
  { id: 'page_how', title: 'How It Works', slug: '/how-it-works', template: 'standard', status: 'published', excerpt: 'Three steps: choose a service, tap Call Now, speak with a provider.', seoTitle: 'How It Works', seoDescription: 'Select a service, tap Call Now and speak with a participating provider.', updatedAt: iso(6) },
  { id: 'page_contact', title: 'Contact', slug: '/contact', template: 'standard', status: 'published', excerpt: 'Contact form and support addresses.', seoTitle: 'Contact Safe Home Network', seoDescription: 'Reach the Safe Home Network team by email or through the contact form.', updatedAt: iso(5) },
  { id: 'page_area', title: 'Service Area', slug: '/service-area', template: 'standard', status: 'published', excerpt: 'Why the ZIP check was removed and how call lines are assigned.', seoTitle: 'Service Area & Call Lines', seoDescription: 'One directory, service lines across the United States.', updatedAt: iso(1) },
  { id: 'page_privacy', title: 'Privacy Policy', slug: '/privacy-policy', template: 'legal', status: 'published', excerpt: 'What we collect, what we do not, and how long we keep it.', seoTitle: 'Privacy Policy', seoDescription: 'How Safe Home Network handles personal information.', updatedAt: iso(8) },
  { id: 'page_terms', title: 'Terms & Conditions', slug: '/terms-and-conditions', template: 'legal', status: 'published', excerpt: 'Terms of use for the directory and referral service.', seoTitle: 'Terms & Conditions', seoDescription: 'The terms that govern use of this website.', updatedAt: iso(8) },
  { id: 'page_disclaimer', title: 'Disclaimer', slug: '/disclaimer', template: 'legal', status: 'published', excerpt: 'We are not the contractor and do not guarantee outcomes.', seoTitle: 'Disclaimer', seoDescription: 'Important information about the referral model.', updatedAt: iso(8) },
  { id: 'page_dns', title: 'Do Not Sell or Share', slug: '/do-not-sell-or-share', template: 'legal', status: 'published', excerpt: 'Categories of information handled and opt-out rights.', seoTitle: 'Do Not Sell or Share My Personal Information', seoDescription: 'Your privacy choices and opt-out rights.', updatedAt: iso(9) },
  { id: 'page_a11y', title: 'Accessibility', slug: '/accessibility', template: 'legal', status: 'published', excerpt: 'Conformance target, known limitations and feedback route.', seoTitle: 'Accessibility Statement', seoDescription: 'Our accessibility commitment and how to report a barrier.', updatedAt: iso(7) },
  { id: 'page_sitemap', title: 'Sitemap', slug: '/sitemap', template: 'landing', status: 'draft', excerpt: 'Human-readable sitemap — draft, generated XML ships instead.', seoTitle: 'Sitemap', seoDescription: 'Every page on Safe Home Network.', updatedAt: iso(12) },
]

/* -------------------------------------------------------------------------- */
/*  Blog                                                                      */
/* -------------------------------------------------------------------------- */

const POSTS: BlogPost[] = [
  {
    id: 'post_roof_age', title: 'How to tell whether your roof needs repair or replacement', slug: 'roof-repair-or-replacement', category: 'Roofing', status: 'published',
    excerpt: 'Age is only one signal. Granule loss, decking condition and leak history usually decide it.',
    featuredImage: '/images/services/roofing.jpg',
    seoTitle: 'Roof Repair vs Replacement: What Decides It',
    seoDescription: 'The signals that separate a repair from a full replacement, and the questions to ask a contractor.',
    author: 'Editorial team', publishedAt: iso(6), updatedAt: iso(6),
  },
  {
    id: 'post_ac_not_cooling', title: 'Six reasons an air conditioner stops cooling', slug: 'ac-not-cooling-reasons', category: 'HVAC', status: 'published',
    excerpt: 'From a clogged filter to a failing capacitor — what a technician actually tests, in order.',
    featuredImage: '/images/services/ac-repair.jpg',
    seoTitle: 'Why Your AC Is Not Cooling',
    seoDescription: 'Common causes of weak cooling and when repair stops making financial sense.',
    author: 'Editorial team', publishedAt: iso(11), updatedAt: iso(10),
  },
  {
    id: 'post_water_48', title: 'The first 48 hours of a water damage claim', slug: 'water-damage-first-48-hours', category: 'Restoration', status: 'published',
    excerpt: 'What to photograph, what to move, and what to leave untouched for the adjuster.',
    featuredImage: '/images/services/water-damage.jpg',
    seoTitle: 'Water Damage: The First 48 Hours',
    seoDescription: 'A practical checklist for documenting water damage before restoration begins.',
    author: 'Editorial team', publishedAt: iso(18), updatedAt: iso(17),
  },
  {
    id: 'post_panel_upgrade', title: 'When an electrical panel upgrade is actually necessary', slug: 'electrical-panel-upgrade', category: 'Electrical', status: 'published',
    excerpt: 'Capacity, age and the warning signs that a service panel is at its limit.',
    featuredImage: '/images/services/electrical.jpg',
    seoTitle: 'Do You Need an Electrical Panel Upgrade?',
    seoDescription: 'How an electrician evaluates panel capacity and when an upgrade is justified.',
    author: 'Editorial team', publishedAt: iso(24), updatedAt: iso(24),
  },
  {
    id: 'post_locksmith_scams', title: 'How to avoid a locksmith scam', slug: 'avoid-locksmith-scams', category: 'Locksmith', status: 'draft',
    excerpt: 'Quoted price versus arrival price, and the questions that expose a call-center referral.',
    featuredImage: '/images/services/locksmith.jpg',
    seoTitle: 'Avoiding Locksmith Scams',
    seoDescription: 'What to confirm before a locksmith starts work.',
    author: 'Editorial team', publishedAt: iso(0), updatedAt: iso(2),
  },
  {
    id: 'post_remodel_budget', title: 'Where a kitchen remodel budget actually goes', slug: 'kitchen-remodel-budget', category: 'Remodeling', status: 'scheduled',
    excerpt: 'Cabinetry and labour dominate; finishes are where the range widens fastest.',
    featuredImage: '/images/services/kitchen-remodeling.jpg',
    seoTitle: 'Kitchen Remodel Budget Breakdown',
    seoDescription: 'The line items that drive a kitchen renovation budget.',
    author: 'Editorial team', publishedAt: iso(-4), updatedAt: iso(1),
  },
]

/* -------------------------------------------------------------------------- */
/*  Homepage sections                                                         */
/* -------------------------------------------------------------------------- */

const SECTIONS: HomepageSection[] = [
  { id: 'sec_hero', key: 'hero', name: 'Hero', heading: 'Your Home Deserves the Right Help.', subheading: 'Explore home service options and call the line assigned to the trade you need.', visible: true, sortOrder: 1 },
  { id: 'sec_picker', key: 'picker', name: 'Service picker', heading: 'Pick a service. Call the line.', subheading: 'No ZIP code, no forms — choose a trade and the published numbers appear.', visible: true, sortOrder: 2 },
  { id: 'sec_trust', key: 'trust', name: 'Trust markers', heading: 'A directory built on published lines', subheading: 'Fifteen categories, two lines per trade, no auto-dialling.', visible: true, sortOrder: 3 },
  { id: 'sec_popular', key: 'popular', name: 'Popular categories', heading: 'Popular categories', subheading: 'The trades homeowners search for most often.', visible: true, sortOrder: 4 },
  { id: 'sec_steps', key: 'steps', name: 'How it works', heading: 'Three steps to a real conversation', subheading: 'Choose, tap, talk.', visible: true, sortOrder: 5 },
  { id: 'sec_benefits', key: 'benefits', name: 'Why homeowners use it', heading: 'Why homeowners use Safe Home Network', subheading: 'Published lines instead of lead-broker guessing games.', visible: true, sortOrder: 6 },
  { id: 'sec_faq', key: 'faq', name: 'FAQ', heading: 'Questions homeowners ask', subheading: 'How the call lines work, and what they do not do.', visible: true, sortOrder: 7 },
  { id: 'sec_cta', key: 'cta', name: 'Closing CTA', heading: 'Ready when you are', subheading: 'Pick the trade and call the line.', visible: false, sortOrder: 8 },
]

/* -------------------------------------------------------------------------- */
/*  Leads                                                                     */
/* -------------------------------------------------------------------------- */

const LEADS: LeadRecord[] = [
  { id: 'lead_1041', name: 'Marisol Vega', email: 'marisol.vega@example.com', phone: '(404) 555-0148', service: 'Roofing', message: 'Storm took shingles off the south slope. Looking for an inspection this week.', source: 'Organic search', status: 'new', priority: 'high', assignedTo: null, createdAt: iso(0, 8) },
  { id: 'lead_1040', name: 'Dane Whitcomb', email: 'd.whitcomb@example.com', phone: '(602) 555-0193', service: 'HVAC', message: 'AC runs but the house never drops below 78. Upstairs unit, 11 years old.', source: 'Paid search', status: 'new', priority: 'high', assignedTo: null, createdAt: iso(0, 7) },
  { id: 'lead_1039', name: 'Priya Raman', email: 'priya.raman@example.com', phone: '(512) 555-0177', service: 'Plumbing', message: 'Slow drain in the kitchen and a faint smell under the sink. No leak visible yet.', source: 'Direct', status: 'contacted', priority: 'normal', assignedTo: 'Demo Administrator', createdAt: iso(1) },
  { id: 'lead_1038', name: 'Terrence Boyd', email: 't.boyd@example.com', phone: '(312) 555-0122', service: 'Water Damage', message: 'Supply line burst overnight. Carpet and baseboards are wet in two rooms.', source: 'Organic search', status: 'qualified', priority: 'high', assignedTo: 'Demo Administrator', createdAt: iso(1, 14) },
  { id: 'lead_1037', name: 'Alicia Monroe', email: 'alicia.monroe@example.com', phone: '(206) 555-0165', service: 'Electrical', message: 'Breaker trips whenever the dryer and microwave run together.', source: 'Social', status: 'contacted', priority: 'normal', assignedTo: 'Demo Administrator', createdAt: iso(2) },
  { id: 'lead_1036', name: 'Grant Keller', email: 'grant.keller@example.com', phone: '(720) 555-0111', service: 'Window Installation', message: 'Six double-hung windows, fogged glass on the west side. Quote requested.', source: 'Referral', status: 'new', priority: 'normal', assignedTo: null, createdAt: iso(2, 16) },
  { id: 'lead_1035', name: 'Sofia Delgado', email: 'sofia.delgado@example.com', phone: '(786) 555-0154', service: 'Pest Control', message: 'Roaches in the kitchen cabinets, seen at night. Need a recurring plan.', source: 'Organic search', status: 'closed', priority: 'low', assignedTo: 'Demo Administrator', createdAt: iso(4) },
  { id: 'lead_1034', name: 'Neil Ashford', email: 'neil.ashford@example.com', phone: '(617) 555-0138', service: 'Kitchen Remodeling', message: 'Full gut remodel, 180 sq ft. Looking at a spring start.', source: 'Direct', status: 'qualified', priority: 'high', assignedTo: 'Demo Administrator', createdAt: iso(5) },
  { id: 'lead_1033', name: 'Deborah Kline', email: 'deborah.kline@example.com', phone: '(901) 555-0127', service: 'Roof Repair', message: 'Small ceiling stain after heavy rain. Want a leak traced before patching.', source: 'Organic search', status: 'contacted', priority: 'normal', assignedTo: null, createdAt: iso(6) },
  { id: 'lead_1032', name: 'Hector Salas', email: 'hector.salas@example.com', phone: '(915) 555-0109', service: 'Locksmith', message: 'Locked out of a rental unit, tenant not answering. Need verification advice.', source: 'Social', status: 'closed', priority: 'low', assignedTo: 'Demo Administrator', createdAt: iso(8) },
  { id: 'lead_1031', name: 'Renee Okafor', email: 'renee.okafor@example.com', phone: '(313) 555-0186', service: 'Bathroom Remodeling', message: 'Tub to shower conversion, tile is failing at the base.', source: 'Referral', status: 'new', priority: 'normal', assignedTo: null, createdAt: iso(9) },
  { id: 'lead_1030', name: 'Colin Pettigrew', email: 'colin.p@example.com', phone: '(503) 555-0142', service: 'Gutters', message: 'Downspouts overflow at the elbow. Two-storey house.', source: 'Paid search', status: 'closed', priority: 'low', assignedTo: 'Demo Administrator', createdAt: iso(11) },
  { id: 'lead_1029', name: 'Yara Haddad', email: 'yara.haddad@example.com', phone: '(469) 555-0198', service: 'AC Repair', message: 'Outdoor unit hums then shuts off after a minute.', source: 'Organic search', status: 'closed', priority: 'normal', assignedTo: 'Demo Administrator', createdAt: iso(13) },
  { id: 'lead_1028', name: 'Owen Brady', email: 'owen.brady@example.com', phone: '(859) 555-0173', service: 'Tree Service', message: 'Large oak limb hanging over the driveway after wind.', source: 'Direct', status: 'closed', priority: 'high', assignedTo: 'Demo Administrator', createdAt: iso(15) },
]

/* -------------------------------------------------------------------------- */
/*  Settings                                                                  */
/* -------------------------------------------------------------------------- */

const SETTINGS: SiteSettings = {
  siteName: SITE.name,
  legalName: SITE.legalName,
  domain: SITE.domain,
  supportEmail: SITE.contact.email,
  supportPhone: SITE.contact.phone,
  addressLines: SITE.contact.addressLines,
  hours: 'Monday–Friday, 9:00–18:00 (Eastern)',
  timezone: 'America/New_York',
  currency: 'USD',
  socials: { facebook: '', x: '', youtube: '' },
  callTrackingEnabled: true,
  leadNotifications: true,
  maintenanceMode: false,
  updatedAt: iso(2),
}

const SEO: SeoSettings = {
  defaultTitle: 'Safe Home Network — Home Services, One Call Away',
  titleTemplate: '%s | Safe Home Network',
  defaultDescription:
    'Pick a home service and call the published line for that trade. Fifteen categories, two lines per trade, no obligation.',
  keywords: ['home services', 'call a contractor', 'roofing', 'plumbing', 'hvac', 'electrical'],
  robots: 'index,follow',
  sitemapEnabled: true,
  canonicalBase: `https://${SITE.domain}`,
  ogImage: '/images/og-default.jpg',
  googleVerification: '',
  analyticsId: '',
  updatedAt: iso(3),
}

const ACTIVITY: ActivityEntry[] = [
  { id: 'act_1', actor: 'Demo Administrator', action: 'Updated heading', target: 'Homepage › Hero', at: iso(0, 8) },
  { id: 'act_2', actor: 'Demo Administrator', action: 'Changed priority on', target: '800-779-3921 (Roofing primary)', at: iso(1, 17) },
  { id: 'act_3', actor: 'Demo Administrator', action: 'Published', target: 'Blog › Roof repair or replacement', at: iso(6, 11) },
  { id: 'act_4', actor: 'Demo Administrator', action: 'Added tracking number', target: '888-353-0358 (Window alternate)', at: iso(9, 14) },
  { id: 'act_5', actor: 'Demo Administrator', action: 'Signed in', target: 'Admin console', at: iso(0, 7) },
]

/* -------------------------------------------------------------------------- */

export const buildSeedWorkspace = (): AdminWorkspace => ({
  version: 1,
  services: buildServices(),
  numbers: buildNumbers(),
  niches: NICHES.map((niche) => ({ ...niche })),
  pages: PAGES.map((page) => ({ ...page, updatedBy: 'Demo Administrator' })),
  posts: POSTS.map((post) => ({ ...post })),
  sections: SECTIONS.map((section) => ({ ...section })),
  leads: LEADS.map((lead) => ({ ...lead })),
  settings: { ...SETTINGS, socials: { ...SETTINGS.socials }, addressLines: [...SETTINGS.addressLines] },
  seo: { ...SEO, keywords: [...SEO.keywords] },
  activity: ACTIVITY.map((entry) => ({ ...entry })),
})

export const DEMO_WORKSPACE_VERSION = 1

export const DEMO_CONTENT_NOTICE =
  'Demo records — content, leads and activity entries are fictional samples used to demonstrate the admin workflows.'

export const ADMIN_VERSION_LABEL = `Phase 1 · static demo · ${ADMIN_CONFIG.version}`
