/**
 * Simulated analytics dataset.
 *
 * ⚠️  EVERY NUMBER IN THIS FILE IS GENERATED. It is not website activity, not
 *     call-network data and not revenue. The dashboard and analytics screens
 *     render a permanent "simulated data" banner so this can never be mistaken
 *     for a real report.
 *
 * The series is deterministic (fixed seed), so reloads and demo resets show the
 * same shape, and tests can assert against it. Phase 2 replaces this module with
 * `GET /analytics` from the PHP + MySQL API.
 */
import type {
  AnalyticsSnapshot,
  DailyMetric,
  KeywordMetric,
  LandingMetric,
  MetricTotals,
  NumberPerformance,
  ServicePerformance,
  SourceMetric,
} from '@/admin/types/admin'
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { SERVICE_NUMBER_MAP } from '@/data/serviceNumberMapping'
import { SERVICES } from '@/config/services'

export const ANALYTICS_WINDOW_DAYS = 90

export const SIMULATED_DATA_NOTICE =
  'Simulated analytics — generated sample data for the admin preview. Not real traffic, calls or revenue.'

/** Deterministic PRNG (mulberry32) so the demo dataset is stable. */
const createRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

const buildDaily = (days: number): DailyMetric[] => {
  const random = createRandom(20261107)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const series: DailyMetric[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const weekday = date.getDay()

    // Gentle growth, weekend dip, mid-week peak, plus deterministic noise.
    const growth = 1 + (days - offset) / (days * 3.2)
    const weekdayFactor = weekday === 0 ? 0.68 : weekday === 6 ? 0.74 : weekday === 2 || weekday === 3 ? 1.12 : 1
    const noise = 0.82 + random() * 0.36
    const visitors = Math.round(340 * growth * weekdayFactor * noise)

    const pageViews = Math.round(visitors * (1.9 + random() * 0.5))
    const calls = Math.round(visitors * (0.058 + random() * 0.032))
    const leads = Math.round(calls * (0.28 + random() * 0.16))
    const revenue = Math.round(calls * (36 + random() * 16) + leads * (14 + random() * 9))

    series.push({ date: toDateKey(date), visitors, pageViews, calls, leads, revenue })
  }
  return series
}

export const DAILY_SERIES: DailyMetric[] = buildDaily(ANALYTICS_WINDOW_DAYS)

const sum = (rows: DailyMetric[], key: keyof Omit<DailyMetric, 'date'>): number =>
  rows.reduce((total, row) => total + row[key], 0)

export const totalsFor = (rows: DailyMetric[]): MetricTotals => {
  const visitors = sum(rows, 'visitors')
  const calls = sum(rows, 'calls')
  const leads = sum(rows, 'leads')
  return {
    visitors,
    pageViews: sum(rows, 'pageViews'),
    calls,
    leads,
    revenue: sum(rows, 'revenue'),
    conversion: visitors === 0 ? 0 : (calls / visitors) * 100,
  }
}

/**
 * Live snapshot supplied by the API (see `liveAnalytics.ts`).
 * While it is null the screens keep using the clearly-labelled simulated set.
 */
let liveSnapshot: AnalyticsSnapshot | null = null

export const setLiveAnalytics = (snapshot: AnalyticsSnapshot | null): void => {
  liveSnapshot = snapshot
}

export const isLiveAnalytics = (): boolean => liveSnapshot !== null

/** Last `days` entries (inclusive of today). */
export const rangeFor = (days: number): DailyMetric[] => {
  const source = liveSnapshot?.daily ?? DAILY_SERIES
  return source.slice(-Math.max(1, days))
}

/** The equally sized window immediately before `days`. */
export const previousRangeFor = (days: number): DailyMetric[] => {
  const source = liveSnapshot?.daily ?? DAILY_SERIES
  const end = source.length - days
  return source.slice(Math.max(0, end - days), end)
}

export const changePercent = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100
  return ((current - previous) / previous) * 100
}

/** Today's row (last entry) — used by the "Today" funnel card. */
export const todayMetrics = (): DailyMetric => DAILY_SERIES[DAILY_SERIES.length - 1]

/* -------------------------------------------------------------------------- */
/*  Dimension tables                                                          */
/* -------------------------------------------------------------------------- */

const SOURCE_ROWS: { source: string; share: number; tone: SourceMetric['tone'] }[] = [
  { source: 'Organic search', share: 0.41, tone: 'brand' },
  { source: 'Direct', share: 0.23, tone: 'slate' },
  { source: 'Paid search', share: 0.16, tone: 'amber' },
  { source: 'Social media', share: 0.12, tone: 'violet' },
  { source: 'Referral', share: 0.08, tone: 'success' },
]

const buildSources = (days: number): SourceMetric[] => {
  const totals = totalsFor(rangeFor(days))
  return SOURCE_ROWS.map((row) => ({
    source: row.source,
    share: row.share * 100,
    tone: row.tone,
    visitors: Math.round(totals.visitors * row.share),
    calls: Math.round(totals.calls * row.share * (row.source === 'Paid search' ? 0.82 : 1)),
  }))
}

const KEYWORDS: KeywordMetric[] = [
  { keyword: 'emergency roof repair near me', clicks: 1840, impressions: 41200, position: 3.4, ctr: 4.5 },
  { keyword: 'ac not cooling house', clicks: 1520, impressions: 33800, position: 2.8, ctr: 4.5 },
  { keyword: 'water damage restoration cost', clicks: 1180, impressions: 29400, position: 4.1, ctr: 4.0 },
  { keyword: 'licensed plumber same day', clicks: 1060, impressions: 27100, position: 3.9, ctr: 3.9 },
  { keyword: 'electrical panel upgrade cost', clicks: 870, impressions: 21300, position: 5.2, ctr: 4.1 },
  { keyword: 'kitchen remodel contractor', clicks: 760, impressions: 24800, position: 6.4, ctr: 3.1 },
  { keyword: 'window replacement financing', clicks: 540, impressions: 18200, position: 7.1, ctr: 3.0 },
  { keyword: 'termite inspection near me', clicks: 480, impressions: 15900, position: 5.8, ctr: 3.0 },
  { keyword: 'locksmith rekey cost', clicks: 410, impressions: 12400, position: 6.9, ctr: 3.3 },
  { keyword: 'bathroom remodel timeline', clicks: 320, impressions: 11100, position: 8.2, ctr: 2.9 },
]

const toTitle = (slug: string): string => {
  const service = SERVICES.find((entry) => entry.slug === slug)
  return service?.name ?? slug
}

const buildLandingPages = (days: number): LandingMetric[] => {
  const totals = totalsFor(rangeFor(days))
  const weights: { path: string; title: string; weight: number }[] = [
    { path: '/', title: 'Homepage', weight: 0.27 },
    { path: '/services/roofing', title: toTitle('roofing'), weight: 0.14 },
    { path: '/services/hvac', title: toTitle('hvac'), weight: 0.12 },
    { path: '/services/plumbing', title: toTitle('plumbing'), weight: 0.11 },
    { path: '/services/water-damage', title: toTitle('water-damage'), weight: 0.09 },
    { path: '/services', title: 'All services', weight: 0.08 },
    { path: '/services/electrical', title: toTitle('electrical'), weight: 0.07 },
    { path: '/services/kitchen-remodeling', title: toTitle('kitchen-remodeling'), weight: 0.06 },
    { path: '/service-area', title: 'Service area', weight: 0.04 },
    { path: '/how-it-works', title: 'How it works', weight: 0.02 },
  ]

  return weights.map((row) => {
    const visitors = Math.round(totals.visitors * row.weight)
    const calls = Math.round(visitors * (0.05 + row.weight * 0.14))
    return {
      path: row.path,
      title: row.title,
      visitors,
      calls,
      conversion: visitors === 0 ? 0 : (calls / visitors) * 100,
    }
  })
}

const buildNumberPerformance = (days: number): NumberPerformance[] => {
  const totalCalls = totalsFor(rangeFor(days)).calls
  const random = createRandom(777)
  const weighted = SERVICE_PHONE_NUMBERS.flatMap((group) =>
    group.numbers.map((phone) => ({
      phone,
      group,
      weight: (phone.priority === 1 ? 1.6 : 1) * (0.6 + random() * 0.9),
    })),
  )
  const weightTotal = weighted.reduce((total, row) => total + row.weight, 0)

  return weighted.map(({ phone, group, weight }) => {
    const calls = Math.max(6, Math.round((weight / weightTotal) * totalCalls))
    return {
      numberId: phone.id,
      number: phone.number,
      group: group.name,
      calls,
      connected: Math.round(calls * (0.72 + random() * 0.17)),
      durationMin: Math.round(calls * (2.4 + random() * 2.6)),
      status: phone.status,
    }
  })
}

const buildServicePerformance = (days: number): ServicePerformance[] => {
  const numbers = buildNumberPerformance(days)
  const callsByGroup = new Map<string, number>()
  for (const group of SERVICE_PHONE_NUMBERS) {
    const groupCalls = group.numbers.reduce(
      (total, phone) => total + (numbers.find((row) => row.numberId === phone.id)?.calls ?? 0),
      0,
    )
    callsByGroup.set(group.id, groupCalls)
  }

  // Several website services can share one directory group (roofing + roof
  // repair, kitchen + bathroom remodeling). Split the group's calls evenly so
  // the per-service numbers add up instead of double counting.
  const servicesPerGroup = new Map<string, number>()
  for (const service of SERVICES) {
    const groupId = SERVICE_NUMBER_MAP[service.slug]?.groupIds[0]
    if (groupId) servicesPerGroup.set(groupId, (servicesPerGroup.get(groupId) ?? 0) + 1)
  }

  const random = createRandom(4242)

  return SERVICES.map((service) => {
    const groupId = SERVICE_NUMBER_MAP[service.slug]?.groupIds[0] ?? null
    const groupCalls = groupId ? callsByGroup.get(groupId) ?? 0 : 0
    const divisor = groupId ? servicesPerGroup.get(groupId) ?? 1 : 1
    const calls = Math.round(groupCalls / divisor)
    const clicks = Math.round(calls * (14 + random() * 12))
    const leads = Math.round(calls * (0.24 + random() * 0.12))

    return {
      serviceId: `svc_${service.slug.replace(/-/g, '_')}`,
      service: service.name,
      groupId,
      clicks,
      calls,
      leads,
      conversion: clicks === 0 ? 0 : (calls / clicks) * 100,
    }
  })
}

const buildSimulatedAnalytics = (days = ANALYTICS_WINDOW_DAYS): AnalyticsSnapshot => ({
  generatedAt: new Date().toISOString(),
  daily: rangeFor(days),
  sources: buildSources(days),
  keywords: KEYWORDS,
  landingPages: buildLandingPages(days),
  services: buildServicePerformance(days),
  numbers: buildNumberPerformance(days),
  devices: [
    { name: 'Mobile', share: 62 },
    { name: 'Desktop', share: 31 },
    { name: 'Tablet', share: 7 },
  ],
  topStates: [
    { state: 'Texas', calls: 412, leads: 148 },
    { state: 'Florida', calls: 388, leads: 141 },
    { state: 'Georgia', calls: 264, leads: 96 },
    { state: 'California', calls: 241, leads: 88 },
    { state: 'Ohio', calls: 187, leads: 66 },
    { state: 'Arizona', calls: 165, leads: 59 },
  ],
})

export const MOCK_ANALYTICS: AnalyticsSnapshot = buildSimulatedAnalytics()

/** Fresh snapshot for the current date, used by the "refresh" action. */
export const refreshAnalytics = (days = ANALYTICS_WINDOW_DAYS): AnalyticsSnapshot => buildAnalytics(days)

/**
 * Returns the live API snapshot when one has been loaded, otherwise the
 * simulated dataset. Both satisfy the same `AnalyticsSnapshot` type, so the
 * screens only need to change their labels.
 */
export const buildAnalytics = (days = ANALYTICS_WINDOW_DAYS): AnalyticsSnapshot =>
  liveSnapshot ?? buildSimulatedAnalytics(days)
