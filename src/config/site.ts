/**
 * ============================================================================
 *  SAFE HOME NETWORK — SITE CONFIGURATION
 * ============================================================================
 * This is the single place to edit brand, contact, legal and SEO defaults.
 * UI components read from here so business details never have to be hunted
 * down in React files.
 *
 * ℹ️  PHONE NUMBERS: service phone numbers live in src/data/serviceNumbers.ts
 * (the live directory used by every call button). `phone` and `phoneDisplay`
 * below are only for an optional company-wide line: leave them empty unless a
 * single number should appear in the header, footer and contact page. Never
 * ship an unverified number.
 * ============================================================================
 */

export interface SiteConfig {
  name: string
  shortName: string
  /** Registered legal entity name. Set before launch — shown on legal pages. */
  legalName: string
  domain: string
  url: string
  tagline: string
  description: string
  modelStatement: string
  contact: {
    /** Dialable number, e.g. "+18005551234". Leave empty until authorized. */
    phone: string
    /** Formatted for display, e.g. "(800) 555-1234". Leave empty until authorized. */
    phoneDisplay: string
    email: string
    supportHours: string
    /** Mailing address. Leave empty if there is no public business address. */
    addressLines: string[]
    /** Response-time expectation shown on the contact page. */
    responseTime: string
  }
  social: {
    facebook: string
    instagram: string
    linkedin: string
    x: string
    youtube: string
  }
  seo: {
    defaultTitle: string
    titleTemplate: string
    defaultDescription: string
    defaultImage: string
    twitterHandle: string
  }
  /**
   * Shows small, clearly-labelled setup notices on legal/contact pages and in
   * coverage results. Set to false once the business details, compliance
   * review and coverage data are finalized.
   */
  /** Persisted theme key. */
  themeStorageKey: string
}

export const SITE: SiteConfig = {
  name: 'Safe Home Network',
  shortName: 'SafeHome',
  legalName: 'Safe Home Network',
  domain: 'safehomenetwork.com',
  url: 'https://safehomenetwork.com',
  tagline: 'Your Home Deserves the Right Help.',
  description:
    'Safe Home Network is a home services connection and referral platform. We help homeowners explore service categories and call the published service line for the trade they need, connecting them with independent local service providers.',
  modelStatement:
    'Safe Home Network is a connection and referral platform, not a contractor. We do not perform home repairs, and we do not employ or dispatch service technicians.',
  contact: {
    phone: '',
    phoneDisplay: '',
    email: 'support@safehomenetwork.com',
    supportHours: 'Monday–Friday, 9:00 AM – 6:00 PM Eastern',
    addressLines: [],
    responseTime: 'We aim to reply to every message within one business day.',
  },
  social: {
    facebook: '',
    instagram: '',
    linkedin: '',
    x: '',
    youtube: '',
  },
  seo: {
    defaultTitle:
      'Safe Home Network | Find Home Service Options in Your Area',
    titleTemplate: '%s | Safe Home Network',
    defaultDescription:
      'Explore home service categories, call the service line for the trade you need, and connect with independent local providers through Safe Home Network.',
    defaultImage: '/images/hero-home.jpg',
    twitterHandle: '',
  },
  themeStorageKey: 'shn-theme',
}

/** Partial site configuration coming from the API's settings endpoint. */
export interface SiteConfigPatch {
  name?: string
  shortName?: string
  legalName?: string
  domain?: string
  url?: string
  tagline?: string
  description?: string
  modelStatement?: string
  contact?: Partial<SiteConfig['contact']>
  social?: Partial<SiteConfig['social']>
}

/**
 * Merges settings published by the API into the SITE object.
 * Undefined values are ignored so a partly-filled settings table never blanks
 * out working copy. Called only when VITE_API_BASE_URL is configured.
 */
export const hydrateSite = (patch: SiteConfigPatch): void => {
  const scalarKeys: (keyof SiteConfigPatch)[] = [
    'name',
    'shortName',
    'legalName',
    'domain',
    'url',
    'tagline',
    'description',
    'modelStatement',
  ]

  scalarKeys.forEach((key) => {
    const value = patch[key]
    if (typeof value === 'string' && value.length > 0) {
      ;(SITE as unknown as Record<string, unknown>)[key] = value
    }
  })

  if (patch.contact) {
    Object.entries(patch.contact).forEach(([key, value]) => {
      if (value === undefined) return
      if (key === 'addressLines' && Array.isArray(value) && value.length === 0) return
      ;(SITE.contact as unknown as Record<string, unknown>)[key] = value
    })
  }

  if (patch.social) {
    Object.entries(patch.social).forEach(([key, value]) => {
      if (typeof value !== 'string') return
      ;(SITE.social as unknown as Record<string, unknown>)[key] = value
    })
  }
}

/** True when an authorized, dialable phone number has been configured. */
export const hasPhone = (): boolean => Boolean(SITE.contact.phone && SITE.contact.phoneDisplay)

/** Builds a tel: href from config. Returns null when no number is configured. */
export const telHref = (): string | null => (hasPhone() ? `tel:${SITE.contact.phone}` : null)

export const CONTACT_EMAIL_HREF = `mailto:${SITE.contact.email}`

export const NAV_LINKS = [
  { label: 'Home', to: '/' },
  { label: 'Services', to: '/services' },
  { label: 'How It Works', to: '/how-it-works' },
  { label: 'About Us', to: '/about' },
  { label: 'Contact', to: '/contact' },
] as const

export const FOOTER_LEGAL_LINKS = [
  { label: 'Privacy Policy', to: '/privacy-policy' },
  { label: 'Terms & Conditions', to: '/terms-and-conditions' },
  { label: 'Disclaimer', to: '/disclaimer' },
  { label: 'Do Not Sell or Share My Personal Information', to: '/do-not-sell-or-share' },
  { label: 'Accessibility Statement', to: '/accessibility' },
] as const

export const FOOTER_COMPANY_LINKS = [
  { label: 'About Us', to: '/about' },
  { label: 'How It Works', to: '/how-it-works' },
  { label: 'Service Area', to: '/service-area' },
  { label: 'All Services', to: '/services' },
  { label: 'Contact', to: '/contact' },
] as const
