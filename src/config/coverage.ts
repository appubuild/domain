/**
 * ============================================================================
 *  ZIP CODE COVERAGE DATASET
 * ============================================================================
 * Coverage is intentionally kept out of the UI. To tell the site where a
 * service is genuinely offered, add a verified record here — no component
 * changes required.
 *
 * ▸ `verified: true`  → the ZIP list (or ZIP prefixes) has been confirmed with
 *                       real participating providers. Only then will the site
 *                       say a service is available.
 * ▸ `verified: false` → the site returns "coverage not verified" and invites
 *                       the homeowner to contact the team. Nothing is claimed.
 * ▸ No record at all  → same as `verified: false`. This is the shipped state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  WHY THE DATASET SHIPS EMPTY
 * ─────────────────────────────────────────────────────────────────────────────
 *  A home services directory must never invent coverage. The list below is
 *  empty until real, contracted coverage is on file, so every ZIP check returns
 *  "coverage not verified — contact our team", which is the truth. As records
 *  are added and marked `verified: true`, the availability answers switch on
 *  automatically.
 *
 *  Example record (copy, fill in real data, then add it to COVERAGE):
 *
 *      {
 *        serviceSlug: 'roofing',
 *        verified: true,
 *        zipPrefixes: ['303', '802'],          // or zips: ['30301', '30303']
 *        note: 'Roof replacement inquiries are accepted in select metro areas.',
 *        lastReviewed: '2026-11-07',
 *      }
 * ============================================================================
 */

import type { CoverageRecord } from '@/types'

/**
 * Confirmed coverage only. Leave empty until you have contracted coverage that
 * you are willing to stand behind publicly.
 */
export const COVERAGE: CoverageRecord[] = []

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
  if (!record || !record.verified) return 'Check availability with your ZIP code'
  const areas = record.zipPrefixes?.length ?? 0
  const zips = record.zips?.length ?? 0
  if (areas === 0 && zips === 0) return 'Check availability with your ZIP code'
  return 'Listed in selected metro areas'
}
