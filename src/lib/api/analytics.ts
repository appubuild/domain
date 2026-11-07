/**
 * First-party analytics collection.
 *
 * Records what the visitor actually did — a page view, a service card click, a
 * call-button click. It never records a "connected call", a lead or revenue:
 * those come from the lead endpoint and from verified tracking-network reports,
 * which the public site cannot write to.
 *
 * Visitors are identified by a random first-party id (not an IP address), and
 * collection is skipped entirely when the browser sends Do Not Track.
 */
import { API_ENABLED, apiRequest } from './client'

const VISITOR_KEY = 'shn-visitor-id'
const SESSION_KEY = 'shn-session-id'

export type PublicEventType = 'page_view' | 'service_click' | 'call_click'

export interface AnalyticsEventInput {
  event_type: PublicEventType
  visitor_id?: string | null
  session_id?: string | null
  path?: string
  referrer?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_term?: string | null
  utm_content?: string | null
  service_id?: number | null
  phone_number_id?: number | null
  device_type?: 'mobile' | 'tablet' | 'desktop' | 'unknown'
}

const canStore = (): boolean => {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage)
  } catch {
    return false
  }
}

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

const readStored = (storage: Storage | null, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

const writeStored = (storage: Storage | null, key: string, value: string): void => {
  try {
    storage?.setItem(key, value)
  } catch {
    /* private mode / quota — analytics degrades silently */
  }
}

export const visitorId = (): string => {
  const existing = readStored(canStore() ? window.localStorage : null, VISITOR_KEY)
  if (existing) return existing
  const next = randomId()
  writeStored(canStore() ? window.localStorage : null, VISITOR_KEY, next)
  return next
}

export const sessionId = (): string => {
  const existing = readStored(typeof window === 'undefined' ? null : window.sessionStorage, SESSION_KEY)
  if (existing) return existing
  const next = randomId()
  writeStored(typeof window === 'undefined' ? null : window.sessionStorage, SESSION_KEY, next)
  return next
}

export const deviceType = (): 'mobile' | 'tablet' | 'desktop' | 'unknown' => {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  if (/mobi|android|iphone/i.test(ua)) return 'mobile'
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop'
  return 'unknown'
}

export const isTrackingAllowed = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const dnt =
    (navigator as unknown as { doNotTrack?: string }).doNotTrack ??
    (window as unknown as { doNotTrack?: string }).doNotTrack
  return dnt !== '1' && dnt !== 'yes'
}

export const utmParams = () => {
  if (typeof window === 'undefined') {
    return { utm_source: null, utm_medium: null, utm_campaign: null, utm_term: null, utm_content: null }
  }
  const params = new URLSearchParams(window.location.search)
  const clean = (key: string): string | null => {
    const value = params.get(key)
    return value ? value.slice(0, 160) : null
  }
  return {
    utm_source: clean('utm_source'),
    utm_medium: clean('utm_medium'),
    utm_campaign: clean('utm_campaign'),
    utm_term: clean('utm_term'),
    utm_content: clean('utm_content'),
  }
}

/** Fire-and-forget batch sender. Failures never affect the visitor. */
export const sendAnalyticsEvents = (events: AnalyticsEventInput[]): void => {
  if (!API_ENABLED || events.length === 0 || !isTrackingAllowed()) return

  void apiRequest('/v1/analytics/events', {
    method: 'POST',
    body: { events },
    timeoutMs: 6000,
  }).catch(() => {
    /* analytics must never surface an error to the visitor */
  })
}

export const trackPageView = (path: string): void => {
  sendAnalyticsEvents([
    {
      event_type: 'page_view',
      path,
      visitor_id: visitorId(),
      session_id: sessionId(),
      referrer: typeof document !== 'undefined' ? document.referrer.slice(0, 500) || null : null,
      device_type: deviceType(),
      ...utmParams(),
    },
  ])
}

export const trackServiceClick = (serviceId: number | null, path: string): void => {
  sendAnalyticsEvents([
    {
      event_type: 'service_click',
      path,
      service_id: serviceId,
      visitor_id: visitorId(),
      session_id: sessionId(),
      device_type: deviceType(),
      ...utmParams(),
    },
  ])
}

export const trackCallClick = (options: {
  serviceId: number | null
  phoneNumberId: number | null
  path: string
}): void => {
  sendAnalyticsEvents([
    {
      event_type: 'call_click',
      path: options.path,
      service_id: options.serviceId,
      phone_number_id: options.phoneNumberId,
      visitor_id: visitorId(),
      session_id: sessionId(),
      device_type: deviceType(),
      ...utmParams(),
    },
  ])
}
