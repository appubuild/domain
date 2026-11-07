/**
 * ============================================================================
 *  API CLIENT — one place that knows how to talk to the PHP API
 * ============================================================================
 *  Base URL comes from the build environment, never from hard-coded strings:
 *
 *      VITE_API_BASE_URL=https://safehomenetwork.com/api
 *
 *  When the variable is empty the site runs entirely from its bundled content
 *  (the static build stays deployable on any host). The admin console uses the
 *  same client, so there is exactly one place where credentials, CSRF headers
 *  and error shapes are handled.
 *
 *  Security notes:
 *   · the admin session lives in an HttpOnly cookie set by the API — no token
 *     is ever written to localStorage by this client;
 *   · unsafe methods send the readable CSRF cookie as X-CSRF-Token (the API
 *     compares it against the hash stored with the session);
 *   · no API keys of any kind are embedded in the bundle.
 * ============================================================================
 */

const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

/** Root of the API including the folder, e.g. https://site.com/api */
export const API_BASE_URL = rawBaseUrl.trim().replace(/\/+$/, '')

/** True when the deployment is configured to read from the PHP API. */
export const API_ENABLED = API_BASE_URL.length > 0

export const CSRF_COOKIE = (import.meta.env.VITE_CSRF_COOKIE as string | undefined) ?? 'shn_csrf'

export const DEFAULT_TIMEOUT_MS = 15000

export interface ApiErrorBody {
  code?: string
  message?: string
  fields?: Record<string, string>
}

/** Normalised API failure — carries the HTTP status and field errors. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>

  constructor(message: string, status = 0, code = 'network_error', fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }

  /** First field error, useful for inline form messages. */
  get firstFieldError(): string | null {
    const [first] = Object.values(this.fields)
    return first ?? null
  }
}

export interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, unknown>
}

type QueryValue = string | number | boolean | undefined | null

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, QueryValue>
  timeoutMs?: number
  signal?: AbortSignal
  /** Extra headers (admin panel uses this rarely; CSRF is automatic). */
  headers?: Record<string, string>
}

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const buildUrl = (path: string, query?: ApiRequestOptions['query']): string => {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const qs = params.toString()
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url
}

const parseError = async (response: Response): Promise<ApiError> => {
  let code = 'request_failed'
  let message = `Request failed with status ${response.status}.`
  let fields: Record<string, string> = {}

  try {
    const payload = (await response.json()) as { error?: ApiErrorBody }
    if (payload?.error) {
      code = payload.error.code ?? code
      message = payload.error.message ?? message
      fields = payload.error.fields ?? {}
    }
  } catch {
    /* non-JSON error body (proxy / host error page) */
  }

  if (response.status === 0) code = 'network_error'
  return new ApiError(message, response.status, code, fields)
}

/**
 * Performs a request and returns the full envelope (`{ data, meta }`).
 * Use `apiRequest` when only the payload is needed.
 */
export const apiRequestEnvelope = async <T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiEnvelope<T>> => {
  if (!API_ENABLED) {
    throw new ApiError('The API base URL is not configured.', 0, 'api_not_configured')
  }

  const method = options.method ?? 'GET'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers ?? {}),
  }

  // FormData (media uploads) must keep the browser's multipart boundary; every
  // other body is JSON.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (options.body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'

  if (method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE)
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: options.body === undefined ? undefined : isFormData ? (options.body as FormData) : JSON.stringify(options.body),
      signal: controller.signal,
    })

    if (!response.ok) throw await parseError(response)
    if (response.status === 204) return { data: undefined as T }

    const payload = (await response.json()) as ApiEnvelope<T> | T
    if (payload && typeof payload === 'object' && 'data' in (payload as ApiEnvelope<T>)) {
      return payload as ApiEnvelope<T>
    }
    return { data: payload as T }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request timed out. Check your connection and try again.', 0, 'timeout')
    }
    throw new ApiError('The API could not be reached. Check your connection and try again.', 0, 'network_error')
  } finally {
    clearTimeout(timeout)
  }
}

export const apiRequest = async <T>(path: string, options: ApiRequestOptions = {}): Promise<T> => {
  const envelope = await apiRequestEnvelope<T>(path, options)
  return envelope.data
}

/** Convenience wrapper for authenticated admin calls. */
export const adminApi = {
  get: <T>(path: string, query?: ApiRequestOptions['query']) => apiRequest<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T = void>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
}
