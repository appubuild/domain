/**
 * ============================================================================
 *  PROVIDER DIRECTORY
 * ============================================================================
 * Each record powers the provider contact card shown after a successful ZIP
 * check: name, category, phone, coverage, availability, disclosure.
 *
 * The list ships EMPTY on purpose. Safe Home Network does not publish
 * provider phone numbers until the provider has authorized publication.
 * While the list is empty (or no provider covers the ZIP), the UI shows:
 *   "Contact our team to explore available service options."
 *
 * ⚠️  Never add an invented or unverified phone number here.
 * ⚠️  Tracking numbers must come from your authorized CallRail / Ringba /
 *     MarketCall account — see src/lib/tracking.ts.
 * ============================================================================
 */

import type { Provider } from '@/types'

export const PROVIDERS: Provider[] = []

/**
 * Copy this template when adding a real provider. Keep the disclosure text
 * accurate for that provider, and only include phone numbers you are
 * authorized to publish.
 */
export const PROVIDER_TEMPLATE: Provider = {
  id: 'provider-example-template',
  name: 'Provider Name',
  serviceSlugs: ['roofing', 'roof-repair'],
  phone: null,
  trackingNumber: null,
  availability: 'available',
  coverageZips: [],
  coverageZipPrefixes: [],
  disclosure:
    'Independent provider. Safe Home Network does not perform this work, and provider availability, pricing and scheduling are set by the provider.',
  credentialNote: '',
  website: '',
}

/** True when at least one provider record has been configured. */
export const PROVIDERS_CONFIGURED = PROVIDERS.length > 0

const matchesZip = (zip: string, zips?: string[], prefixes?: string[]): boolean => {
  if (zips?.includes(zip)) return true
  if (prefixes?.some((prefix) => zip.startsWith(prefix))) return true
  return false
}

/** Providers matching a service + ZIP. Empty array means "none published". */
export const getProvidersFor = (serviceSlug: string, zip: string): Provider[] =>
  PROVIDERS.filter((provider) => {
    const servesService = provider.serviceSlugs.includes(serviceSlug)
    if (!servesService) return false
    if (provider.availability === 'unavailable') return false
    const hasCoverageDefinition =
      (provider.coverageZips?.length ?? 0) > 0 || (provider.coverageZipPrefixes?.length ?? 0) > 0
    if (!hasCoverageDefinition) return false
    return matchesZip(zip, provider.coverageZips, provider.coverageZipPrefixes)
  })
