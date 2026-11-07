/**
 * Loads the admin analytics screens from the PHP API.
 *
 * Every figure is measured: page views / clicks come from `analytics_events`,
 * leads from `leads`, connected calls from `call_records` and revenue from
 * `revenue_records`. When the API is not configured, or the request fails, the
 * screens keep their clearly-labelled simulated dataset instead of showing
 * invented numbers.
 */
import { useEffect, useState } from 'react'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import type {
  AnalyticsSnapshot,
  DailyMetric,
  LandingMetric,
  NumberPerformance,
  ServicePerformance,
  SourceMetric,
} from '@/admin/types/admin'
import { apiClient } from './apiClient'
import { setLiveAnalytics } from './analytics'

const WINDOW_DAYS = 90

const isoDate = (date: Date): string => date.toISOString().slice(0, 10)

const rangeQuery = () => {
  const to = new Date()
  const from = new Date(to.getTime() - (WINDOW_DAYS - 1) * 86_400_000)
  return { from: isoDate(from), to: isoDate(to) }
}

interface ApiSeriesRow {
  bucket: string
  page_views: number
  unique_visitors: number
  service_clicks: number
  call_clicks: number
  leads: number
  connected_calls: number
  revenue: number
}

interface ApiSourceRow {
  source: string
  page_views: number
  visitors: number
  calls: number
  service_clicks: number
}

interface ApiLandingRow {
  path: string
  views: number
  visitors: number
  calls: number
}

interface ApiServiceRow {
  id: number
  name: string
  slug: string
  service_clicks: number
  call_clicks: number
  leads: number
}

interface ApiNumberRow {
  id: number
  number: string
  label: string | null
  status: 'active' | 'pending-verification' | 'inactive'
  group_name: string | null
  call_clicks: number
  connected_calls: number
}

interface ApiDeviceRow {
  device_type: string
  events: number
  visitors: number
}

const TONES: SourceMetric['tone'][] = ['brand', 'success', 'amber', 'violet', 'slate']
const DEVICE_LABELS: Record<string, string> = {
  mobile: 'Mobile',
  desktop: 'Desktop',
  tablet: 'Tablet',
  unknown: 'Unknown',
}

const percent = (part: number, total: number): number => (total <= 0 ? 0 : Math.round((part / total) * 1000) / 10)

export interface LiveAnalyticsState {
  /** True once a real snapshot has been loaded from the API. */
  live: boolean
  loading: boolean
  error: string | null
  /** Increments after each successful load so memoised views can recompute. */
  version: number
}

export const useLiveAnalytics = (): LiveAnalyticsState => {
  const enabled = ADMIN_CONFIG.api.enabled
  const [state, setState] = useState<LiveAnalyticsState>({
    live: false,
    loading: enabled,
    error: null,
    version: 0,
  })

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const query = rangeQuery()

    const load = async (): Promise<void> => {
      const [series, sources, landing, services, numbers, devices] = await Promise.all([
        apiClient.request<{ series: ApiSeriesRow[] }>('/admin/analytics/timeseries', {
          query: { ...query, granularity: 'day' },
        }),
        apiClient.request<ApiSourceRow[]>('/admin/analytics/sources', { query }),
        apiClient.request<ApiLandingRow[]>('/admin/analytics/landing-pages', { query }),
        apiClient.request<ApiServiceRow[]>('/admin/analytics/services', { query }),
        apiClient.request<ApiNumberRow[]>('/admin/analytics/numbers', { query }),
        apiClient.request<ApiDeviceRow[]>('/admin/analytics/devices', { query }),
      ])

      const daily: DailyMetric[] = series.series.map((row) => ({
        date: row.bucket,
        visitors: Number(row.unique_visitors ?? 0),
        pageViews: Number(row.page_views ?? 0),
        calls: Number(row.call_clicks ?? 0),
        leads: Number(row.leads ?? 0),
        revenue: Number(row.revenue ?? 0),
      }))

      const totalVisitors = sources.reduce((sum, row) => sum + Number(row.visitors ?? 0), 0)
      const sourceRows: SourceMetric[] = sources.map((row, index) => ({
        source: row.source || 'Direct',
        visitors: Number(row.visitors ?? 0),
        calls: Number(row.calls ?? 0),
        share: percent(Number(row.visitors ?? 0), totalVisitors),
        tone: TONES[index % TONES.length],
      }))

      const landingRows: LandingMetric[] = landing.map((row) => ({
        path: row.path,
        title: row.path,
        visitors: Number(row.visitors ?? 0),
        calls: Number(row.calls ?? 0),
        conversion: percent(Number(row.calls ?? 0), Number(row.views ?? 0)),
      }))

      const serviceRows: ServicePerformance[] = services.map((row) => ({
        serviceId: String(row.id),
        service: row.name,
        groupId: null,
        clicks: Number(row.service_clicks ?? 0),
        calls: Number(row.call_clicks ?? 0),
        leads: Number(row.leads ?? 0),
        conversion: percent(Number(row.call_clicks ?? 0), Number(row.service_clicks ?? 0)),
      }))

      const numberRows: NumberPerformance[] = numbers.map((row) => ({
        numberId: String(row.id),
        number: row.number,
        group: row.group_name ?? '',
        calls: Number(row.call_clicks ?? 0),
        connected: Number(row.connected_calls ?? 0),
        durationMin: 0,
        status: row.status,
      }))

      const totalDeviceEvents = devices.reduce((sum, row) => sum + Number(row.events ?? 0), 0)
      const deviceRows: { name: string; share: number }[] = devices.map((row) => ({
        name: DEVICE_LABELS[row.device_type] ?? 'Unknown',
        share: percent(Number(row.events ?? 0), totalDeviceEvents),
      }))

      const snapshot: AnalyticsSnapshot = {
        generatedAt: new Date().toISOString(),
        daily,
        sources: sourceRows,
        // Google Search Console is a separate integration: no keyword data is
        // claimed until it is connected and verified.
        keywords: [],
        landingPages: landingRows,
        services: serviceRows,
        numbers: numberRows,
        devices: deviceRows,
        // Caller location is only known when the tracking network reports it.
        topStates: [],
      }

      setLiveAnalytics(snapshot)

      if (!cancelled) {
        setState((current) => ({ live: true, loading: false, error: null, version: current.version + 1 }))
      }
    }

    load().catch((error: unknown) => {
      if (cancelled) return
      setLiveAnalytics(null)
      setState((current) => ({
        live: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Analytics could not be loaded.',
        version: current.version,
      }))
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}
