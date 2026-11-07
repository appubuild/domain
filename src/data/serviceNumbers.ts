/**
 * ============================================================================
 *  SERVICE PHONE DIRECTORY — SINGLE SOURCE OF TRUTH
 * ============================================================================
 * Every phone number shown anywhere on this website comes from this file.
 * Service pages, the availability dialog, the homepage finder and the service
 * area page all read from here — never from hard-coded markup.
 *
 * ---------------------------------------------------------------------------
 *  ACTIVATION RULES (read before editing)
 * ---------------------------------------------------------------------------
 *  `status` must be "active" before a number is published to the public site.
 *
 *    active               → eligible to be shown publicly (still subject to the
 *                           campaign eligibility check below)
 *    pending-verification → imported from the owner list, NOT verified, hidden
 *                           from public visitors
 *    inactive             → retired / paused, always hidden
 *
 *  A number is only displayed publicly when BOTH are true:
 *    1. status === 'active'
 *    2. the campaign permissions allow traffic from the visitor's location
 *       (see `campaign` below and src/lib/phoneDirectory.ts)
 *
 *  All twenty numbers currently ship as "pending-verification", so the public
 *  site shows a contact message instead of a number. That is intentional:
 *  do not flip these to "active" until the number and its campaign terms have
 *  been verified with the network that owns it.
 *
 * ---------------------------------------------------------------------------
 *  ADDING OR MANAGING NUMBERS
 * ---------------------------------------------------------------------------
 *  - Add a number: add an object to `numbers` (lowest `priority` = primary).
 *  - Retire a number: set status to "inactive" (keeps history, hides it).
 *  - Multiple numbers per service: just add more objects; priority decides
 *    which is "Call Now" and which are "Call Alternate".
 *  - Multiple networks/campaigns: use the `campaign` block, e.g.
 *
 *      campaign: {
 *        network: 'Network A',
 *        campaign: 'Q4 roofing nationwide',
 *        nationwide: true,          // only when the network confirmed it
 *        states: ['GA', 'FL'],      // optional state allow-list
 *        zipCodes: ['30301'],       // optional ZIP allow-list
 *        notes: 'Confirmed with network on 2026-11-10',
 *      }
 *
 *  No component changes are needed to add a network, a number or a restriction.
 * ============================================================================
 */

export type PhoneNumberStatus = 'active' | 'pending-verification' | 'inactive'

export interface NumberCampaign {
  /** Call network or vendor that owns the number. */
  network?: string
  /** Campaign / tracking pool name. */
  campaign?: string
  /**
   * True ONLY when the campaign terms explicitly permit nationwide traffic.
   * Leave undefined when unknown — the UI then shows a verification message
   * instead of offering the number.
   */
  nationwide?: boolean
  /** Optional state allow-list (two-letter abbreviations). */
  states?: string[]
  /** Optional ZIP allow-list. */
  zipCodes?: string[]
  notes?: string
}

export interface ServicePhoneNumber {
  id: string
  /** Display format as supplied by the owner. */
  number: string
  /** 1 = primary "Call Now", 2+ = alternates, in ascending order. */
  priority: number
  status: PhoneNumberStatus
  campaign?: NumberCampaign
}

export interface ServicePhoneGroup {
  id: string
  name: string
  numbers: ServicePhoneNumber[]
}

export const SERVICE_PHONE_NUMBERS: ServicePhoneGroup[] = [
  {
    id: 'appliance',
    name: 'Appliance',
    numbers: [
      { id: 'appliance-1', number: '800-692-7205', priority: 1, status: 'pending-verification' },
      { id: 'appliance-2', number: '888-560-3029', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical',
    numbers: [
      { id: 'electrical-1', number: '800-692-4680', priority: 1, status: 'pending-verification' },
      { id: 'electrical-2', number: '888-925-0361', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'hvac',
    name: 'HVAC',
    numbers: [
      { id: 'hvac-1', number: '800-816-9035', priority: 1, status: 'pending-verification' },
      { id: 'hvac-2', number: '888-391-0143', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'plumbing',
    name: 'Plumbing',
    numbers: [
      { id: 'plumbing-1', number: '800-736-1462', priority: 1, status: 'pending-verification' },
      { id: 'plumbing-2', number: '888-861-2884', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'garage-door',
    name: 'Garage Door',
    numbers: [
      { id: 'garage-door-1', number: '800-738-5598', priority: 1, status: 'pending-verification' },
      { id: 'garage-door-2', number: '888-714-0941', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'gutters',
    name: 'Gutters',
    numbers: [
      { id: 'gutters-1', number: '800-741-8602', priority: 1, status: 'pending-verification' },
      { id: 'gutters-2', number: '888-729-0842', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'bathroom-kitchen-remodeling',
    name: 'Bathroom & Kitchen Remodeling',
    numbers: [
      { id: 'remodeling-1', number: '800-692-6718', priority: 1, status: 'pending-verification' },
      { id: 'remodeling-2', number: '888-884-4234', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'roofing',
    name: 'Roofing',
    numbers: [
      { id: 'roofing-1', number: '800-779-3921', priority: 1, status: 'pending-verification' },
      { id: 'roofing-2', number: '888-863-0629', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'tree-service',
    name: 'Tree Service',
    numbers: [
      { id: 'tree-service-1', number: '800-763-9887', priority: 1, status: 'pending-verification' },
      { id: 'tree-service-2', number: '888-835-0252', priority: 2, status: 'pending-verification' },
    ],
  },
  {
    id: 'window',
    name: 'Window',
    numbers: [
      { id: 'window-1', number: '800-779-8592', priority: 1, status: 'pending-verification' },
      { id: 'window-2', number: '888-353-0358', priority: 2, status: 'pending-verification' },
    ],
  },
]

/**
 * Safety switch for local review. When the site runs in development you can see
 * how the call buttons will look — clearly marked as unpublished — without
 * publishing anything. In a production build this is always false.
 */
export const PREVIEW_UNPUBLISHED_NUMBERS: boolean = import.meta.env.DEV

/** Guard rail: a pending number can never be published by accident. */
export const PUBLISH_ONLY_ACTIVE_NUMBERS = true
