/**
 * US ZIP code → city / state lookup.
 *
 * Provider: Zippopotam.us (free, no key). The base URL is configurable so it can
 * be swapped for another provider later without touching components:
 *   VITE_ZIP_LOOKUP_URL=https://api.zippopotam.us
 *
 * The lookup answers "where is this ZIP code?" only. It says nothing about
 * whether a phone campaign accepts traffic from that location — that is a
 * separate decision handled in src/lib/phoneDirectory.ts.
 */

import { normalizeZip, validateZip } from '@/lib/zip'

export interface UsLocation {
  zip: string
  city: string
  state: string
  stateAbbr: string
}

export type ZipLookupErrorCode = 'invalid' | 'not-found' | 'service-unavailable' | 'network' | 'timeout'

export type ZipLookupResult =
  | { ok: true; location: UsLocation; cached: boolean }
  | { ok: false; error: ZipLookupErrorCode; message: string }

const BASE_URL = (
  (import.meta.env.VITE_ZIP_LOOKUP_URL as string | undefined) || 'https://api.zippopotam.us'
).replace(/\/$/, '')

const TIMEOUT_MS = 8000
const SESSION_KEY = 'shn-zip-cache-v1'
const MAX_CACHE_ENTRIES = 40

const memoryCache = new Map<string, UsLocation>()

const readSessionCache = (): Record<string, UsLocation> => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, UsLocation>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeSessionCache = (cache: Record<string, UsLocation>) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(cache))
  } catch {
    /* Storage may be unavailable (private mode / quota) — memory cache still works. */
  }
}

const remember = (location: UsLocation) => {
  memoryCache.set(location.zip, location)
  const session = readSessionCache()
  session[location.zip] = location
  const keys = Object.keys(session)
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach((key) => delete session[key])
  }
  writeSessionCache(session)
}

interface ZippopotamResponse {
  'post code'?: string
  places?: Array<{
    'place name'?: string
    state?: string
    'state abbreviation'?: string
  }>
}

const ERROR_MESSAGES: Record<ZipLookupErrorCode, string> = {
  invalid: 'Enter a valid 5-digit US ZIP code.',
  'not-found': 'We could not find that ZIP code. Please double-check the five digits.',
  'service-unavailable':
    'The ZIP code lookup service is not reachable right now. Please try again in a moment.',
  network: 'We could not reach the ZIP code lookup service. Check your connection and try again.',
  timeout: 'The ZIP code lookup took too long. Please try again.',
}

const failure = (error: ZipLookupErrorCode, message?: string): ZipLookupResult => ({
  ok: false,
  error,
  message: message ?? ERROR_MESSAGES[error],
})

export interface LookupZipOptions {
  /** Bypass the cache and hit the provider again. */
  force?: boolean
  /** Optional external abort signal (e.g. component unmount). */
  signal?: AbortSignal
}

export const lookupZip = async (rawZip: string, options: LookupZipOptions = {}): Promise<ZipLookupResult> => {
  const zip = normalizeZip(rawZip)

  const validation = validateZip(zip)
  if (!validation.valid) return failure('invalid', validation.message)

  if (!options.force) {
    const cached = memoryCache.get(zip) ?? readSessionCache()[zip]
    if (cached) {
      memoryCache.set(zip, cached)
      return { ok: true, location: cached, cached: true }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const onExternalAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onExternalAbort)

  try {
    const response = await fetch(`${BASE_URL}/us/${zip}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (response.status === 404) return failure('not-found')
    if (response.status === 429) {
      return failure('service-unavailable', 'The ZIP lookup service is busy. Please try again shortly.')
    }
    if (!response.ok) return failure('service-unavailable')

    const data = (await response.json()) as ZippopotamResponse
    const place = data.places?.[0]

    if (!place || !place['place name'] || !place.state || !place['state abbreviation']) {
      return failure('not-found')
    }

    const location: UsLocation = {
      zip,
      city: place['place name'],
      state: place.state,
      stateAbbr: place['state abbreviation'].toUpperCase(),
    }

    remember(location)
    return { ok: true, location, cached: false }
  } catch (error) {
    const err = error as { name?: string }
    if (err?.name === 'AbortError') return failure('timeout')
    return failure('network')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** Clears the in-memory + session cache (used by tests and by "change ZIP"). */
export const clearZipCache = (): void => {
  memoryCache.clear()
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* noop */
  }
}

export const formatLocation = (location: UsLocation): string => `${location.city}, ${location.stateAbbr}`
