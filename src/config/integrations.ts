/**
 * Integration configuration driven by Vite environment variables.
 * Nothing secret belongs here — these are all public, client-side identifiers.
 *
 * Add a .env file locally (see .env.example) or set these in your hosting
 * dashboard. Every integration is inert until configured: no fake calls, no
 * fabricated conversion events, no simulated submissions.
 */

const env = import.meta.env

export type TrackingProviderId = 'callrail' | 'ringba' | 'marketcalls' | 'gtm' | 'none'

export interface Integrations {
  /** Where the contact form posts. Empty = form is not connected yet. */
  contactEndpoint: string
  /** Basic spam-protection token for the current provider (e.g. reCAPTCHA site key). */
  spamProtectionSiteKey: string
  /** Which authorized call-tracking platform to load, if any. */
  trackingProvider: TrackingProviderId
  /** Account / company identifier for the tracking platform. */
  trackingAccountId: string
  /** Optional swap target for CallRail's dynamic number insertion script. */
  callrailSwapTarget: string
  /** Google Analytics 4 measurement id. */
  gaMeasurementId: string
  /** Whether analytics and advertising scripts may load before consent. */
  analyticsRequiresConsent: boolean
}

export const INTEGRATIONS: Integrations = {
  contactEndpoint: (env.VITE_CONTACT_ENDPOINT as string) || '',
  spamProtectionSiteKey: (env.VITE_SPAM_PROTECTION_SITE_KEY as string) || '',
  trackingProvider: ((env.VITE_CALL_TRACKING_PROVIDER as string) || 'none') as TrackingProviderId,
  trackingAccountId: (env.VITE_CALL_TRACKING_ACCOUNT_ID as string) || '',
  callrailSwapTarget: (env.VITE_CALLRAIL_SWAP_TARGET as string) || '',
  gaMeasurementId: (env.VITE_GA_MEASUREMENT_ID as string) || '',
  analyticsRequiresConsent: true,
}

/** The contact form can only truly submit when an endpoint is configured. */
export const CONTACT_FORM_CONNECTED = Boolean(INTEGRATIONS.contactEndpoint)

/** Call tracking is only active when both a provider and an account id exist. */
export const TRACKING_ENABLED =
  INTEGRATIONS.trackingProvider !== 'none' && Boolean(INTEGRATIONS.trackingAccountId)
