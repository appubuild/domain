import { INTEGRATIONS, TRACKING_ENABLED } from '@/config/integrations'

/**
 * Call-tracking integration layer.
 *
 * The component layer never calls a vendor directly. It emits a tracking intent
 * with `tracking.onCallIntent(...)`, and whichever adapter is configured decides
 * what happens. With no provider configured this is a no-op — no fake call
 * events are ever generated.
 *
 * To enable CallRail:
 *   VITE_CALL_TRACKING_PROVIDER=callrail
 *   VITE_CALL_TRACKING_ACCOUNT_ID=<your company id>
 *   (and load CallRail's dynamic number insertion script from their dashboard)
 */

export type TrackingEvent =
  | 'zip_check_submitted'
  | 'zip_check_result'
  | 'call_intent'
  | 'contact_form_view'
  | 'contact_form_submit'
  | 'service_page_view'

export interface TrackingPayload {
  service?: string
  zip?: string
  status?: string
  providerId?: string
  path?: string
}

type Adapter = {
  id: string
  ready: boolean
  track: (event: TrackingEvent, payload?: TrackingPayload) => void
}

const consoleAdapter: Adapter = {
  id: 'console',
  ready: import.meta.env.DEV && TRACKING_ENABLED,
  track: (event, payload) => {
    // Development-only visibility when a real provider is wired up.
    console.debug('[tracking]', event, payload)
  },
}

const dataLayerAdapter: Adapter = {
  id: 'dataLayer',
  ready: TRACKING_ENABLED,
  track: (event, payload) => {
    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    if (!Array.isArray(w.dataLayer)) return
    w.dataLayer.push({
      event,
      tracking_provider: INTEGRATIONS.trackingProvider,
      tracking_account: INTEGRATIONS.trackingAccountId,
      ...payload,
    })
  },
}

const adapters: Adapter[] = [dataLayerAdapter, consoleAdapter]

const track = (event: TrackingEvent, payload?: TrackingPayload): void => {
  adapters.filter((adapter) => adapter.ready).forEach((adapter) => adapter.track(event, payload))
}

export const tracking = {
  enabled: TRACKING_ENABLED,
  /**
   * Records the *intent* to call — it never claims a call was connected or
   * converted. The tracking platform itself owns that outcome.
   */
  onCallIntent: (payload: TrackingPayload): void => track('call_intent', payload),
  onZipCheck: (payload: TrackingPayload): void => track('zip_check_submitted', payload),
  onZipResult: (payload: TrackingPayload): void => track('zip_check_result', payload),
  onServiceView: (payload: TrackingPayload): void => track('service_page_view', payload),
  onContactSubmit: (payload: TrackingPayload): void => track('contact_form_submit', payload),
}
