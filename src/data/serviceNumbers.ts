/**
 * ============================================================================
 *  SERVICE PHONE DIRECTORY — SINGLE SOURCE OF TRUTH
 * ============================================================================
 * Every phone number shown anywhere on this website comes from this file.
 * Service pages, the availability dialog, the homepage finder and the service
 * area page all read from here — never from hard-coded markup.
 *
 * ---------------------------------------------------------------------------
 *  CURRENT STATE — LIVE
 * ---------------------------------------------------------------------------
 *  The owner confirmed all twenty lines as correct and live on 2026-11-07.
 *  Every number therefore ships as `status: 'active'` with an explicit
 *  nationwide campaign permission, so a visitor who confirms a US ZIP code
 *  sees the priority-1 line as "Call Now" and the priority-2 line as
 *  "Call Alternate".
 *
 * ---------------------------------------------------------------------------
 *  ACTIVATION RULES (read before editing)
 * ---------------------------------------------------------------------------
 *  `status` controls publication:
 *
 *    active               → eligible to be shown publicly (still subject to the
 *                           campaign eligibility check below)
 *    pending-verification → held back; must be verified before it may appear
 *    inactive             → retired / paused, always hidden
 *
 *  A number is only displayed publicly when BOTH are true:
 *    1. status === 'active'
 *    2. the campaign permissions allow traffic from the visitor's location
 *
 *  If no number passes both checks, the site shows a contact message instead.
 *  It never guesses, never substitutes another trade's line and never shows a
 *  number that is not authorized for the visitor's area.
 *
 * ---------------------------------------------------------------------------
 *  RESTRICTING A LINE TO CERTAIN AREAS
 * ---------------------------------------------------------------------------
 *  If a line is only authorized in some states or ZIP codes, give it an
 *  allow-list instead of nationwide coverage — the site then hides that line
 *  everywhere else automatically:
 *
 *      campaign: ownerConfirmedCampaign({ states: ['GA', 'FL'] })
 *      campaign: ownerConfirmedCampaign({ zipCodes: ['30301', '30303'] })
 *
 *  ZIP allow-lists are the most specific rule and override state lists.
 *  No component changes are ever needed for this.
 *
 * ---------------------------------------------------------------------------
 *  ADDING, REMOVING AND ASSIGNING NUMBERS
 * ---------------------------------------------------------------------------
 *  - Add a number: add an object to `numbers` (lowest `priority` = primary).
 *  - Retire a number: set status to "inactive" (keeps history, hides it).
 *  - Several numbers per service: just add more objects; `priority` decides
 *    which one is "Call Now" and which are "Call Alternate".
 *  - Several networks / campaigns: use the `campaign` block, e.g.
 *
 *      campaign: {
 *        network: 'Network A',
 *        campaign: 'Q4 roofing nationwide',
 *        nationwide: true,
 *        states: ['GA', 'FL'],
 *        zipCodes: ['30301'],
 *        notes: 'Confirmed with network on 2026-11-10',
 *      }
 *
 *  Which service shows which group is decided in
 *  src/data/serviceNumberMapping.ts — again, no component edits required.
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

/**
 * Campaign metadata for the owner-confirmed lines.
 *
 * `nationwide: true` records the owner's confirmation (2026-11-07) that these
 * toll-free lines accept calls from anywhere in the United States. Pass an
 * override to restrict a specific line to certain states or ZIP codes — the
 * allow-list then wins and nationwide coverage is switched off automatically.
 *
 * Returns a fresh object on every call, so one group can never mutate another
 * group's permissions by accident.
 */
export const ownerConfirmedCampaign = (overrides: Partial<NumberCampaign> = {}): NumberCampaign => {
  const restricted = Boolean(overrides.states?.length || overrides.zipCodes?.length)
  return {
    notes: 'Owner confirmed this line as live and correct on 2026-11-07.',
    ...overrides,
    nationwide: restricted ? false : (overrides.nationwide ?? true),
  }
}

export const SERVICE_PHONE_NUMBERS: ServicePhoneGroup[] = [
  {
    id: 'appliance',
    name: 'Appliance',
    numbers: [
      { id: 'appliance-1', number: '800-692-7205', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'appliance-2', number: '888-560-3029', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical',
    numbers: [
      { id: 'electrical-1', number: '800-692-4680', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'electrical-2', number: '888-925-0361', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'hvac',
    name: 'HVAC',
    numbers: [
      { id: 'hvac-1', number: '800-816-9035', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'hvac-2', number: '888-391-0143', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'plumbing',
    name: 'Plumbing',
    numbers: [
      { id: 'plumbing-1', number: '800-736-1462', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'plumbing-2', number: '888-861-2884', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'garage-door',
    name: 'Garage Door',
    numbers: [
      { id: 'garage-door-1', number: '800-738-5598', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'garage-door-2', number: '888-714-0941', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'gutters',
    name: 'Gutters',
    numbers: [
      { id: 'gutters-1', number: '800-741-8602', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'gutters-2', number: '888-729-0842', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'bathroom-kitchen-remodeling',
    name: 'Bathroom & Kitchen Remodeling',
    numbers: [
      { id: 'remodeling-1', number: '800-692-6718', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'remodeling-2', number: '888-884-4234', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'roofing',
    name: 'Roofing',
    numbers: [
      { id: 'roofing-1', number: '800-779-3921', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'roofing-2', number: '888-863-0629', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'tree-service',
    name: 'Tree Service',
    numbers: [
      { id: 'tree-service-1', number: '800-763-9887', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'tree-service-2', number: '888-835-0252', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
  {
    id: 'window',
    name: 'Window',
    numbers: [
      { id: 'window-1', number: '800-779-8592', priority: 1, status: 'active', campaign: ownerConfirmedCampaign() },
      { id: 'window-2', number: '888-353-0358', priority: 2, status: 'active', campaign: ownerConfirmedCampaign() },
    ],
  },
]

/**
 * Safety switch for local review. When the site runs in development you can see
 * how a held-back number would look — clearly marked as unpublished — without
 * publishing anything. In a production build this is always false.
 */
/**
 * Replaces the bundled directory with numbers published by the API.
 * The API only returns numbers that are mapped to a service and marked active,
 * so the publication rules in this file are applied server-side in that mode.
 */
export const hydrateServicePhoneNumbers = (groups: ServicePhoneGroup[]): void => {
  if (groups.length === 0) return
  SERVICE_PHONE_NUMBERS.splice(0, SERVICE_PHONE_NUMBERS.length, ...groups)
}

export const PREVIEW_UNPUBLISHED_NUMBERS: boolean = import.meta.env.DEV

/** Guard rail: only `status: 'active'` numbers can ever be published. */
export const PUBLISH_ONLY_ACTIVE_NUMBERS = true
