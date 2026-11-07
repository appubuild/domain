/**
 * Derived views over the admin workspace.
 *
 * Keeping these here (instead of inside components) means the same rules are
 * used by the dashboard, the tables and the future API responses.
 */
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { SERVICE_NUMBER_MAP } from '@/data/serviceNumberMapping'
import type {
  LeadStatus,
  PhoneStatus,
  ServiceRecord,
  TrackingNumber,
} from '@/admin/types/admin'

export const DIRECTORY_GROUPS = SERVICE_PHONE_NUMBERS.map((group) => ({
  id: group.id,
  name: group.name,
  numberCount: group.numbers.length,
}))

export const groupName = (groupId: string | null): string => {
  if (!groupId) return 'No call group'
  return SERVICE_PHONE_NUMBERS.find((group) => group.id === groupId)?.name ?? groupId
}

/** The website slugs that share a directory group (used for mapping hints). */
export const serviceSlugsForGroup = (groupId: string): string[] =>
  Object.entries(SERVICE_NUMBER_MAP)
    .filter(([, mapping]) => mapping.groupIds.includes(groupId))
    .map(([slug]) => slug)

export const numbersForService = (
  numbers: TrackingNumber[],
  service: ServiceRecord | undefined,
): TrackingNumber[] => {
  if (!service?.groupId) return []
  return numbers
    .filter((row) => row.groupId === service.groupId)
    .sort((a, b) => a.priority - b.priority || a.number.localeCompare(b.number))
}

export const servicesForGroup = (services: ServiceRecord[], groupId: string): ServiceRecord[] =>
  services.filter((service) => service.groupId === groupId)

export const primaryNumberOf = (numbers: TrackingNumber[]): TrackingNumber | undefined =>
  [...numbers].sort((a, b) => a.priority - b.priority).find((row) => row.status === 'active')

export const roleLabel = (priority: number): 'Primary' | 'Alternate' =>
  priority === 1 ? 'Primary' : 'Alternate'

export type Tone = 'brand' | 'success' | 'amber' | 'rose' | 'slate' | 'violet'

export const phoneStatusTone: Record<PhoneStatus, Tone> = {
  active: 'success',
  'pending-verification': 'amber',
  inactive: 'slate',
}

export const leadStatusTone: Record<LeadStatus, Tone> = {
  new: 'brand',
  contacted: 'amber',
  qualified: 'violet',
  closed: 'slate',
}

export const contentStatusTone = (status: string): Tone => {
  switch (status) {
    case 'published':
    case 'active':
      return 'success'
    case 'scheduled':
      return 'violet'
    case 'pending-verification':
      return 'amber'
    case 'paused':
      return 'rose'
    default:
      return 'slate'
  }
}

export interface DirectoryHealth {
  services: number
  publishedServices: number
  servicesWithoutNumbers: number
  groups: number
  numbers: number
  activeNumbers: number
  pendingNumbers: number
  inactiveNumbers: number
  primaryCoverage: number
}

export const directoryHealth = (
  services: ServiceRecord[],
  numbers: TrackingNumber[],
): DirectoryHealth => {
  const groups = new Set(numbers.map((row) => row.groupId))
  const withNumbers = services.filter((service) => numbersForService(numbers, service).length > 0)
  return {
    services: services.length,
    publishedServices: services.filter((service) => service.status === 'published').length,
    servicesWithoutNumbers: services.length - withNumbers.length,
    groups: groups.size,
    numbers: numbers.length,
    activeNumbers: numbers.filter((row) => row.status === 'active').length,
    pendingNumbers: numbers.filter((row) => row.status === 'pending-verification').length,
    inactiveNumbers: numbers.filter((row) => row.status === 'inactive').length,
    primaryCoverage: withNumbers.length === 0 ? 0 : (withNumbers.length / services.length) * 100,
  }
}
