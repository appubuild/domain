/**
 * Phone directory resolution + call eligibility.
 *
 * Two separate questions are answered here and never confused:
 *
 *   1. Is a number published?      → status must be "active"
 *   2. May that campaign accept a call from the visitor's location?
 *                                  → campaign.nationwide / states / zipCodes
 *
 * A number is offered publicly only when both answers are yes. When campaign
 * permissions are unknown, the UI shows a verification message rather than a
 * number.
 */

import {
  PREVIEW_UNPUBLISHED_NUMBERS,
  PUBLISH_ONLY_ACTIVE_NUMBERS,
  SERVICE_PHONE_NUMBERS,
  type ServicePhoneNumber,
} from '@/data/serviceNumbers'
import { getGroupsForService, getServiceNumberLabel } from '@/data/serviceNumberMapping'
import type { UsLocation } from '@/lib/zipLookup'

export type NumberEligibility = 'eligible' | 'restricted' | 'unverified'

export interface ResolvedCallNumber {
  id: string
  /** Display format exactly as supplied by the owner, e.g. 800-779-3921 */
  display: string
  /** Dialable link, E.164 for US numbers, e.g. tel:+18007793921 */
  telHref: string
  priority: number
  slot: 'primary' | 'alternate'
  status: ServicePhoneNumber['status']
  /** True when the number may be shown to public visitors. */
  published: boolean
  eligibility: NumberEligibility
  eligibilityNote?: string
  network?: string
  campaign?: string
}

export type CallDirectoryState =
  /** No phone directory group is mapped to this service. */
  | { kind: 'no-directory'; label: string }
  /** Numbers exist but none has been activated for publication. */
  | { kind: 'awaiting-verification'; label: string; pendingCount: number }
  /** Development-only preview of unpublished numbers (never in production). */
  | { kind: 'preview'; label: string; numbers: ResolvedCallNumber[] }
  /** Published numbers exist, but we need a ZIP/state before offering one. */
  | { kind: 'needs-location'; label: string }
  /** Published numbers exist, but their campaigns do not confirm this location. */
  | { kind: 'unverified-location'; label: string; location: UsLocation }
  /** At least one published number may accept traffic from this location. */
  | { kind: 'ready'; label: string; location?: UsLocation; numbers: ResolvedCallNumber[] }

/** Converts an owner-supplied display number into a dialable US tel: link. */
export const toTelHref = (display: string): string => `tel:+1${display.replace(/\D/g, '')}`

export const formatDisplayNumber = (display: string): string => display

interface CampaignEvaluation {
  eligibility: NumberEligibility
  note?: string
}

export const evaluateCampaign = (
  number: ServicePhoneNumber,
  location?: UsLocation | null,
): CampaignEvaluation => {
  const campaign = number.campaign

  if (!campaign) {
    return {
      eligibility: 'unverified',
      note: 'Campaign permissions for this number have not been confirmed.',
    }
  }

  // ZIP allow-list is the most specific rule and wins when present.
  if (campaign.zipCodes && campaign.zipCodes.length > 0) {
    if (!location) return { eligibility: 'unverified', note: 'A ZIP code is needed for this campaign.' }
    return campaign.zipCodes.includes(location.zip)
      ? { eligibility: 'eligible' }
      : { eligibility: 'restricted', note: `This campaign does not list ZIP ${location.zip}.` }
  }

  // State allow-list.
  if (campaign.states && campaign.states.length > 0) {
    if (!location) return { eligibility: 'unverified', note: 'A ZIP code is needed for this campaign.' }
    return campaign.states.map((state) => state.toUpperCase()).includes(location.stateAbbr)
      ? { eligibility: 'eligible' }
      : {
          eligibility: 'restricted',
          note: `This campaign does not accept calls from ${location.stateAbbr}.`,
        }
  }

  // Explicit nationwide permission only.
  if (campaign.nationwide === true) return { eligibility: 'eligible' }

  return {
    eligibility: 'unverified',
    note: 'Nationwide coverage has not been confirmed for this campaign.',
  }
}

const sortNumbers = (numbers: ServicePhoneNumber[]): ServicePhoneNumber[] =>
  [...numbers].sort((a, b) => a.priority - b.priority)

const toResolved = (
  number: ServicePhoneNumber,
  index: number,
  published: boolean,
  eligibility: NumberEligibility,
  note?: string,
): ResolvedCallNumber => ({
  id: number.id,
  display: number.number,
  telHref: toTelHref(number.number),
  priority: number.priority,
  slot: index === 0 ? 'primary' : 'alternate',
  status: number.status,
  published,
  eligibility,
  eligibilityNote: note,
  network: number.campaign?.network,
  campaign: number.campaign?.campaign,
})

export interface ResolveCallDirectoryOptions {
  serviceSlug: string
  serviceName: string
  location?: UsLocation | null
  /** Overrides the environment default (used by tests). */
  previewUnpublished?: boolean
}

/**
 * Resolves which call options (if any) may be shown for a service.
 */
export const resolveCallDirectory = ({
  serviceSlug,
  serviceName,
  location,
  previewUnpublished = PREVIEW_UNPUBLISHED_NUMBERS,
}: ResolveCallDirectoryOptions): CallDirectoryState => {
  const label = getServiceNumberLabel(serviceSlug, serviceName)
  const groups = getGroupsForService(serviceSlug)
  const allNumbers = sortNumbers(groups.flatMap((group) => group.numbers))

  if (groups.length === 0 || allNumbers.length === 0) {
    return { kind: 'no-directory', label }
  }

  const activeNumbers = PUBLISH_ONLY_ACTIVE_NUMBERS
    ? allNumbers.filter((number) => number.status === 'active')
    : allNumbers.filter((number) => number.status !== 'inactive')

  if (activeNumbers.length === 0) {
    if (previewUnpublished) {
      const numbers = allNumbers
        .filter((number) => number.status !== 'inactive')
        .map((number, index) => toResolved(number, index, false, 'unverified'))
      if (numbers.length > 0) return { kind: 'preview', label, numbers }
    }
    return {
      kind: 'awaiting-verification',
      label,
      pendingCount: allNumbers.filter((number) => number.status === 'pending-verification').length,
    }
  }

  if (!location) return { kind: 'needs-location', label }

  const evaluated = activeNumbers.map((number, index) => {
    const evaluation = evaluateCampaign(number, location)
    return toResolved(number, index, true, evaluation.eligibility, evaluation.note)
  })

  const eligible = evaluated.filter((number) => number.eligibility === 'eligible')
  if (eligible.length === 0) return { kind: 'unverified-location', label, location }

  return {
    kind: 'ready',
    label,
    location,
    numbers: eligible.map((number, index) => ({ ...number, slot: index === 0 ? 'primary' : 'alternate' })),
  }
}

/** True when the service has any phone-directory group at all. */
export const hasCallDirectory = (serviceSlug: string): boolean => getGroupsForService(serviceSlug).length > 0

/** Totals used by tests and the owner-facing documentation. */
export const directoryStats = () => {
  const numbers = SERVICE_PHONE_NUMBERS.flatMap((group) => group.numbers)
  return {
    groups: SERVICE_PHONE_NUMBERS.length,
    total: numbers.length,
    active: numbers.filter((number) => number.status === 'active').length,
    pending: numbers.filter((number) => number.status === 'pending-verification').length,
    inactive: numbers.filter((number) => number.status === 'inactive').length,
  }
}
