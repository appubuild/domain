import { COVERAGE, COVERAGE_EXCLUSIONS, EXAMPLE_COVERAGE_DATA } from '@/config/coverage'
import { getProvidersFor } from '@/config/providers'
import { getService } from '@/config/services'
import { validateZip, normalizeZip } from '@/lib/zip'
import type { AvailabilityResult, CoverageRecord } from '@/types'

const matchesCoverage = (zip: string, record: CoverageRecord): boolean => {
  const exclusions = COVERAGE_EXCLUSIONS[record.serviceSlug] ?? []
  if (exclusions.includes(zip)) return false
  if (record.zips?.includes(zip)) return true
  if (record.zipPrefixes?.some((prefix) => zip.startsWith(prefix))) return true
  return false
}

/**
 * Resolves availability for a service + ZIP against the configured dataset.
 *
 * Rules (deliberately conservative):
 *  - No record, or a record that is not verified → "unverified". We never claim
 *    availability from unconfirmed data.
 *  - Verified record and the ZIP matches → "available".
 *  - Verified record and the ZIP does not match → "unavailable".
 */
export const checkAvailability = (serviceSlug: string, rawZip: string): AvailabilityResult | null => {
  const zip = normalizeZip(rawZip)
  if (!validateZip(zip).valid) return null

  const service = getService(serviceSlug)
  if (!service) return null

  const record = COVERAGE.find((entry) => entry.serviceSlug === serviceSlug)
  const providers = getProvidersFor(serviceSlug, zip)

  if (!record || !record.verified) {
    return {
      zip,
      serviceSlug,
      serviceName: service.name,
      status: 'unverified',
      dataSource: 'none',
      note: record?.note,
      providers,
    }
  }

  const inCoverage = matchesCoverage(zip, record)

  return {
    zip,
    serviceSlug,
    serviceName: service.name,
    status: inCoverage ? 'available' : 'unavailable',
    dataSource: EXAMPLE_COVERAGE_DATA ? 'example' : 'configured',
    note: record.note,
    lastReviewed: record.lastReviewed,
    providers: inCoverage ? providers : [],
  }
}

/** Services that currently have any verified coverage record. */
export const servicesWithVerifiedCoverage = (): string[] =>
  COVERAGE.filter((record) => record.verified).map((record) => record.serviceSlug)
