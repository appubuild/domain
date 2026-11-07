/**
 * Admin API client.
 *
 * A thin adapter over the shared client in `src/lib/api/client.ts`: the admin
 * console and the public site therefore share one implementation of the base
 * URL, the `{ data, meta }` envelope, CSRF headers and error handling.
 *
 * Authentication is cookie-based (HttpOnly session + readable CSRF cookie set
 * by the API), so nothing is stored in localStorage here — the demo build is
 * the only mode that keeps credentials in the browser.
 */
import { API_ENABLED, ApiError, apiRequest, apiRequestEnvelope } from '@/lib/api/client'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'

export { ApiError }

export class ApiNotConfiguredError extends Error {
  constructor() {
    super('The PHP API is not configured. Set VITE_API_BASE_URL to enable server mode.')
    this.name = 'ApiNotConfiguredError'
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
}

const buildPath = (path: string): string => {
  const version = ADMIN_CONFIG.api.version
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `/${version}${suffix}`
}

export const apiClient = {
  get isConfigured(): boolean {
    return ADMIN_CONFIG.api.enabled && API_ENABLED
  },

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    if (!this.isConfigured) throw new ApiNotConfiguredError()
    return apiRequest<T>(buildPath(path), options)
  },

  /** Full envelope, when the caller needs pagination metadata. */
  async envelope<T>(path: string, options: ApiRequestOptions = {}) {
    if (!this.isConfigured) throw new ApiNotConfiguredError()
    return apiRequestEnvelope<T>(buildPath(path), options)
  },
}

/** Sessions live in HttpOnly cookies now; kept for backwards compatibility. */
export const getApiToken = (): null => null
