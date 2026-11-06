/**
 * ============================================================================
 *  ZIP CODE COVERAGE DATASET
 * ============================================================================
 * Coverage is intentionally kept out of the UI. To update where a service is
 * offered, edit this file — no component changes required.
 *
 * ▸ `verified: true`  → the ZIP list is confirmed with real participating
 *                       providers. Only then will the site say a service is
 *                       available.
 * ▸ `verified: false` → the site returns "coverage not verified" and invites
 *                       the homeowner to contact the team. Nothing is claimed.
 *
 * ⚠️  SHIPPED DATA IS EXAMPLE DATA. The records below use representative metro
 * ZIP prefixes so the availability flow can be demonstrated end to end. They
 * are clearly labelled in the UI as an example dataset. Replace them with your
 * contracted coverage before launch and set EXAMPLE_COVERAGE_DATA to false.
 * ============================================================================
 */

import type { CoverageRecord } from '@/types'

/** Set to false once COVERAGE contains real, contracted coverage. */
export const EXAMPLE_COVERAGE_DATA = true

export const COVERAGE: CoverageRecord[] = [
  {
    serviceSlug: 'roofing',
    verified: true,
    zipPrefixes: ['303', '802', '752', '276', '606', '850'],
    note: 'Roof replacement inquiries are accepted in select metro areas.',
    lastReviewed: '2026-09-15',
  },
  {
    serviceSlug: 'roof-repair',
    verified: true,
    zipPrefixes: ['303', '802', '752', '276', '606'],
    note: 'Repair and storm-damage inquiries are accepted in select metro areas.',
    lastReviewed: '2026-09-15',
  },
  {
    serviceSlug: 'plumbing',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '372', '480'],
    note: 'Plumbing connection requests are accepted in select metro areas.',
    lastReviewed: '2026-10-01',
  },
  {
    serviceSlug: 'hvac',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '372', '850', '852'],
    note: 'HVAC connection requests are accepted in select metro areas.',
    lastReviewed: '2026-10-01',
  },
  {
    serviceSlug: 'ac-repair',
    verified: true,
    zipPrefixes: ['303', '752', '850', '852', '480', '276'],
    note: 'Cooling-related requests are seasonal and may be limited in winter months.',
    lastReviewed: '2026-10-01',
  },
  {
    serviceSlug: 'water-damage',
    verified: true,
    zipPrefixes: ['303', '752', '606', '276', '802'],
    note: 'Restoration referrals are time-sensitive; availability can change hourly.',
    lastReviewed: '2026-09-20',
  },
  {
    serviceSlug: 'pest-control',
    verified: true,
    zipPrefixes: ['303', '752', '606', '372', '480', '850'],
    note: 'Pest control requests are accepted in select metro areas.',
    lastReviewed: '2026-08-30',
  },
  {
    serviceSlug: 'kitchen-remodeling',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '276'],
    note: 'Kitchen remodeling inquiries are limited to areas with participating remodelers.',
    lastReviewed: '2026-09-05',
  },
  {
    serviceSlug: 'bathroom-remodeling',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '276', '480'],
    note: 'Bathroom remodeling inquiries are limited to areas with participating remodelers.',
    lastReviewed: '2026-09-05',
  },
  {
    serviceSlug: 'bedroom-remodeling',
    verified: false,
    note: 'Bedroom remodeling coverage is being confirmed. Please contact our team.',
  },
  {
    serviceSlug: 'electrical',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '372', '480'],
    note: 'Licensed electrical work is arranged through independent electricians.',
    lastReviewed: '2026-09-12',
  },
  {
    serviceSlug: 'window-installation',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606', '372'],
    note: 'Window replacement inquiries are accepted in select metro areas.',
    lastReviewed: '2026-08-22',
  },
  {
    serviceSlug: 'door-installation',
    verified: true,
    zipPrefixes: ['303', '802', '752', '606'],
    note: 'Door installation inquiries are accepted in select metro areas.',
    lastReviewed: '2026-08-22',
  },
  {
    serviceSlug: 'concrete-paving',
    verified: false,
    note: 'Concrete and paving coverage is being confirmed. Please contact our team.',
  },
  {
    serviceSlug: 'locksmith',
    verified: false,
    note: 'Locksmith coverage is not yet verified. Please contact our team to confirm.',
  },
]

/**
 * ZIP codes that are explicitly excluded even if a prefix matches, e.g. a
 * metro prefix that also covers a county you do not serve.
 */
export const COVERAGE_EXCLUSIONS: Record<string, string[]> = {
  // 'roofing': ['30301'],
}

/** Human-readable coverage scope used on cards and the service area page. */
export const coverageSummary = (slug: string): string => {
  const record = COVERAGE.find((entry) => entry.serviceSlug === slug)
  if (!record || !record.verified) return 'Availability confirmed by ZIP check'
  const areas = record.zipPrefixes?.length ?? 0
  const zips = record.zips?.length ?? 0
  if (areas === 0 && zips === 0) return 'Availability confirmed by ZIP check'
  return 'Listed in selected metro areas'
}
