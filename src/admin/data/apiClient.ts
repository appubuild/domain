/**
 * Phase 2 API client placeholder — intentionally NOT connected.
 *
 * `ADMIN_CONFIG.api.enabled` is false for Phase 1, so nothing in the app calls
 * this module. It exists so the PHP + MySQL work has one obvious place to land:
 * fill in `baseUrl`, flip `enabled`, and every repository method gains a real
 * endpoint without a single UI change.
 */
import { ADMIN_CONFIG, storageKey } from '@/admin/config/adminConfig'
import { readJSON, storage } from './storage'

export class ApiNotConfiguredError extends Error {
  constructor() {
    super(
      'The Phase 2 PHP + MySQL API is not configured. Set ADMIN_CONFIG.api.baseUrl and api.enabled = true.',
    )
    this.name = 'ApiNotConfiguredError'
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
}

const buildUrl = (path: string, query?: ApiRequestOptions['query']): string => {
  const { baseUrl, version } = ADMIN_CONFIG.api
  const root = `${baseUrl.replace(/\/$/, '')}/${version}`
  const url = new URL(`${root}${path}`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) url.searchParams.set(key, String(value))
    })
  }
  return url.toString()
}

const TOKEN_KEY = storageKey(ADMIN_CONFIG.storage.token)

/** Reads the session token a future API login will store. */
export const getApiToken = (): string | null =>
  readJSON<string | null>(TOKEN_KEY, null) ?? storage.get(TOKEN_KEY)

export const apiClient = {
  get isConfigured(): boolean {
    return ADMIN_CONFIG.api.enabled && ADMIN_CONFIG.api.baseUrl.length > 0
  },

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    if (!this.isConfigured) throw new ApiNotConfiguredError()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ADMIN_CONFIG.api.timeoutMs)
    const token = getApiToken()

    try {
      const response = await fetch(buildUrl(path, options.query), {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { [ADMIN_CONFIG.api.authHeader]: `${ADMIN_CONFIG.api.authScheme}${token}` } : {}),
        },
        credentials: 'include',
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new Error(message || `Request failed with status ${response.status}`)
      }
      if (response.status === 204) return undefined as T
      return (await response.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  },
}
