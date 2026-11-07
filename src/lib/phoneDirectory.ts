/**
 * Service call directory resolution.
 *
 * The site is deliberately simple now: a visitor picks a service and the
 * primary + alternate numbers assigned to that service become dialable links.
 * There is no ZIP code step, no coverage lookup and no location check anywhere.
 *
 * Publication rule (unchanged, and still the safety net):
 *   A number is only offered when it is `status: 'active'` AND its campaign is
 *   explicitly permitted for this site. Campaigns that are restricted to states
 *   or ZIP codes are held back, because the site no longer collects a location
 *   and therefore cannot honour that restriction.
 *
 * Nothing here invents, reorders across services, or rewrites a phone number:
 * every value comes from src/data/serviceNumbers.ts.
 */

import {
  PREVIEW_UNPUBLISHED_NUMBERS,
  PUBLISH_ONLY_ACTIVE_NUMBERS,
  SERVICE_PHONE_NUMBERS,
  type ServicePhoneNumber,
} from '@/data/serviceNumbers'
import { getGroupsForService, getServiceNumberLabel } from '@/data/serviceNumberMapping'

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
}

export type ServiceCallState =
  /** No phone directory group is mapped to this service. */
  | { kind: 'no-directory'; label: string }
  /** Numbers exist but none has been activated for publication. */
  | { kind: 'awaiting-verification'; label: string; pendingCount: number }
  /** Development-only preview of unpublished numbers (never in production). */
  | { kind: 'preview'; label: string; numbers: ResolvedCallNumber[] }
  /** At least one published number exists for this service. */
  | { kind: 'ready'; label: string; numbers: ResolvedCallNumber[] }

/** Converts an owner-supplied display number into a dialable US tel: link. */
export const toTelHref = (display: string): string => `tel:+1${display.replace(/\D/g, '')}`

export const formatDisplayNumber = (display: string): string => display

/**
 * True when the campaign metadata allows this site to publish the number
 * without knowing the visitor's location. State/ZIP-restricted campaigns are
 * excluded on purpose — we would rather show a contact message than break a
 * network's routing rules.
 */
export const isCampaignPermitted = (number: ServicePhoneNumber): boolean => {
  const campaign = number.campaign
  if (!campaign) return false
  if (campaign.zipCodes && campaign.zipCodes.length > 0) return false
  if (campaign.states && campaign.states.length > 0) return false
  return campaign.nationwide === true
}

const sortNumbers = (numbers: ServicePhoneNumber[]): ServicePhoneNumber[] =>
  [...numbers].sort((a, b) => a.priority - b.priority)

const toResolved = (
  number: ServicePhoneNumber,
  index: number,
  published: boolean,
): ResolvedCallNumber => ({
  id: number.id,
  display: number.number,
  telHref: toTelHref(number.number),
  priority: number.priority,
  slot: index === 0 ? 'primary' : 'alternate',
  status: number.status,
  published,
})

export interface ResolveServiceCallOptions {
  serviceSlug: string
  serviceName: string
  /** Overrides the environment default (used by tests). */
  previewUnpublished?: boolean
}

/**
 * Resolves the call options for a service. No location argument exists — by
 * design, selecting the service is all the input this needs.
 */
export const resolveServiceCall = ({
  serviceSlug,
  serviceName,
  previewUnpublished = PREVIEW_UNPUBLISHED_NUMBERS,
}: ResolveServiceCallOptions): ServiceCallState => {
  const label = getServiceNumberLabel(serviceSlug, serviceName)
  const groups = getGroupsForService(serviceSlug)
  const allNumbers = sortNumbers(groups.flatMap((group) => group.numbers))

  if (groups.length === 0 || allNumbers.length === 0) {
    return { kind: 'no-directory', label }
  }

  const candidates = PUBLISH_ONLY_ACTIVE_NUMBERS
    ? allNumbers.filter((number) => number.status === 'active')
    : allNumbers.filter((number) => number.status !== 'inactive')

  const publishable = candidates.filter(isCampaignPermitted)

  if (publishable.length === 0) {
    if (previewUnpublished) {
      const numbers = allNumbers
        .filter((number) => number.status !== 'inactive')
        .map((number, index) => toResolved(number, index, false))
      if (numbers.length > 0) return { kind: 'preview', label, numbers }
    }
    return {
      kind: 'awaiting-verification',
      label,
      pendingCount: allNumbers.filter((number) => number.status === 'pending-verification').length,
    }
  }

  return {
    kind: 'ready',
    label,
    numbers: publishable.map((number, index) => toResolved(number, index, true)),
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
    publishable: numbers.filter((number) => number.status === 'active' && isCampaignPermitted(number)).length,
  }
}
