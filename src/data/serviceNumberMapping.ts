/**
 * ============================================================================
 *  SERVICE ↔ PHONE DIRECTORY MAPPING
 * ============================================================================
 * Bridges the website's service pages (src/config/services.ts) to the phone
 * directory groups (src/data/serviceNumbers.ts).
 *
 * Rules honoured here:
 *  - A service only receives numbers from its own directory group. A number is
 *    never reused across unrelated services.
 *  - Services with no authorized group (water damage, pest control, locksmith,
 *    bedroom remodeling, concrete, doors) fall back to the contact message
 *    rather than borrowing another trade's number.
 * ============================================================================
 */

import { SERVICE_PHONE_NUMBERS, type ServicePhoneGroup } from '@/data/serviceNumbers'

export interface ServiceNumberMapping {
  /** Directory group ids that may answer calls for this service. */
  groupIds: string[]
  /** Human label used in the call panel heading. */
  label: string
}

/** Website service slug → phone directory group(s). */
export const SERVICE_NUMBER_MAP: Record<string, ServiceNumberMapping> = {
  roofing: { groupIds: ['roofing'], label: 'Roofing services' },
  'roof-repair': { groupIds: ['roofing'], label: 'Roof repair services' },
  plumbing: { groupIds: ['plumbing'], label: 'Plumbing services' },
  hvac: { groupIds: ['hvac'], label: 'HVAC services' },
  'ac-repair': { groupIds: ['hvac'], label: 'Heating & cooling services' },
  electrical: { groupIds: ['electrical'], label: 'Electrical services' },
  'kitchen-remodeling': { groupIds: ['bathroom-kitchen-remodeling'], label: 'Kitchen remodeling' },
  'bathroom-remodeling': { groupIds: ['bathroom-kitchen-remodeling'], label: 'Bathroom remodeling' },
  'window-installation': { groupIds: ['window'], label: 'Window services' },
  // No authorized call group exists for these categories yet. They intentionally
  // show a contact message instead of an unrelated trade's number.
  'water-damage': { groupIds: [], label: 'Water damage restoration' },
  'pest-control': { groupIds: [], label: 'Pest control' },
  'bedroom-remodeling': { groupIds: [], label: 'Bedroom remodeling' },
  'door-installation': { groupIds: [], label: 'Door installation' },
  'concrete-paving': { groupIds: [], label: 'Concrete & paving' },
  locksmith: { groupIds: [], label: 'Locksmith services' },
}

/**
 * Directory shown in the homepage / service area finder. One entry per phone
 * directory group; `serviceSlug` links to the matching website page when one
 * exists, so visitors can read about the work before calling.
 */
export interface CallDirectoryCategory {
  groupId: string
  label: string
  blurb: string
  icon: string
  serviceSlug?: string
}

export const CALL_DIRECTORY_CATEGORIES: CallDirectoryCategory[] = [
  {
    groupId: 'roofing',
    label: 'Roofing',
    blurb: 'Roof replacement, leaks and storm damage',
    icon: 'home',
    serviceSlug: 'roofing',
  },
  {
    groupId: 'plumbing',
    label: 'Plumbing',
    blurb: 'Leaks, clogs, water heaters and repipes',
    icon: 'droplets',
    serviceSlug: 'plumbing',
  },
  {
    groupId: 'hvac',
    label: 'HVAC',
    blurb: 'Heating, cooling, ducts and tune-ups',
    icon: 'wind',
    serviceSlug: 'hvac',
  },
  {
    groupId: 'electrical',
    label: 'Electrical',
    blurb: 'Panels, outlets, lighting and EV chargers',
    icon: 'zap',
    serviceSlug: 'electrical',
  },
  {
    groupId: 'appliance',
    label: 'Appliance',
    blurb: 'Appliance repair and installation',
    icon: 'wrench',
  },
  {
    groupId: 'garage-door',
    label: 'Garage Door',
    blurb: 'Openers, springs, panels and repair',
    icon: 'door-open',
  },
  {
    groupId: 'gutters',
    label: 'Gutters',
    blurb: 'Cleaning, guards, repair and replacement',
    icon: 'waves',
  },
  {
    groupId: 'tree-service',
    label: 'Tree Service',
    blurb: 'Removal, trimming and storm cleanup',
    icon: 'layers',
  },
  {
    groupId: 'window',
    label: 'Window',
    blurb: 'Replacement, glass and installation',
    icon: 'app-window',
    serviceSlug: 'window-installation',
  },
  {
    groupId: 'bathroom-kitchen-remodeling',
    label: 'Bath & Kitchen',
    blurb: 'Remodeling, cabinets, tile and fixtures',
    icon: 'bath',
    serviceSlug: 'bathroom-remodeling',
  },
]

const GROUPS_BY_ID: Record<string, ServicePhoneGroup> = SERVICE_PHONE_NUMBERS.reduce(
  (acc, group) => {
    acc[group.id] = group
    return acc
  },
  {} as Record<string, ServicePhoneGroup>,
)

export const getPhoneGroup = (groupId: string): ServicePhoneGroup | undefined => GROUPS_BY_ID[groupId]

/**
 * Directory groups mapped to a website service slug (may be empty).
 * A directory group id is also accepted directly — the homepage finder uses
 * group ids for categories such as Appliance and Gutters that have no page.
 */
export const getGroupsForService = (serviceKey: string): ServicePhoneGroup[] => {
  const mapping = SERVICE_NUMBER_MAP[serviceKey]
  if (mapping) {
    return mapping.groupIds
      .map((id) => GROUPS_BY_ID[id])
      .filter((group): group is ServicePhoneGroup => Boolean(group))
  }
  const direct = GROUPS_BY_ID[serviceKey]
  return direct ? [direct] : []
}

export const getServiceNumberLabel = (serviceKey: string, fallbackName: string): string =>
  SERVICE_NUMBER_MAP[serviceKey]?.label ?? GROUPS_BY_ID[serviceKey]?.name ?? fallbackName
