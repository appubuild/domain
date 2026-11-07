/**
 * ============================================================================
 *  ADMIN CONFIGURATION
 * ============================================================================
 *  Everything the admin console needs to boot, in one place.
 *
 *  ┌───────────────────────────────────────────────────────────────────────┐
 *  │  DEMO AUTHENTICATION — NOT PRODUCTION SECURITY                        │
 *  │  The credentials below live in the browser bundle because Phase 1 is  │
 *  │  a static panel with no server. Anyone who can read the bundle can    │
 *  │  read them. They exist only so the owner can review the workflows.    │
 *  │                                                                       │
 *  │  Phase 2 replaces this with PHP + MySQL: hashed passwords, HTTP-only  │
 *  │  sessions, rate limiting and server-side route protection. Nothing    │
 *  │  in Phase 2 should depend on `ADMIN_CONFIG.demo`.                     │
 *  └───────────────────────────────────────────────────────────────────────┘
 *
 *  Phase 2: set `VITE_API_BASE_URL` (e.g. https://safehomenetwork.com/api) and
 *  the console switches to password-hashed, HTTP-only cookie sessions served by
 *  the PHP API. The demo credentials below are then ignored, and the login
 *  screen stops advertising them.
 * ============================================================================
 */

/** Absolute or same-origin API root, e.g. `https://site.com/api`. */
const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

/** True when the build is wired to the PHP + MySQL API. */
export const API_MODE_ENABLED = API_BASE_URL.length > 0

export type AuthMode = 'demo' | 'api'

export const ADMIN_CONFIG = {
  version: '2.0.0',
  product: {
    name: 'Safe Home Network',
    consoleName: 'Admin Console',
    tagline: 'Directory, content and call tracking',
  },

  /** `api` = PHP session cookie; `demo` = client-side check (no backend). */
  authMode: (API_BASE_URL.length > 0 ? 'api' : 'demo') as AuthMode,

  demo: {
    /** ← change these two values to change the demo login. */
    email: 'info@safehomenetwork.com',
    password: 'Sa123456',

    name: 'Demo Administrator',
    role: 'Owner',
    initials: 'DA',
    /** Session lifetime in hours. Sessions expire and must be re-established. */
    sessionHours: 8,
    /** Shown on the login screen so the demo is never mistaken for security. */
    notice:
      'Demo mode — credentials are stored in the browser bundle. Production authentication arrives with the Phase 2 PHP + MySQL API.',
  },

  /**
   * Enabled automatically when VITE_API_BASE_URL is present. `baseUrl` excludes
   * the version segment; the client appends `/v1`.
   */
  api: {
    enabled: API_BASE_URL.length > 0,
    baseUrl: API_BASE_URL,
    version: 'v1',
    timeoutMs: 15000,
    /** Paths are relative to `/v1` (auth lives outside `/admin`). */
    endpoints: {
      login: '/auth/login',
      logout: '/auth/logout',
      session: '/auth/session',
      services: '/admin/services',
      numbers: '/admin/phone-numbers',
      niches: '/admin/niches',
      pages: '/admin/pages',
      posts: '/admin/blog',
      sections: '/admin/homepage-sections',
      leads: '/admin/leads',
      settings: '/admin/settings',
      seo: '/admin/settings/seo',
      analytics: '/admin/analytics',
      team: '/admin/team',
      activity: '/admin/activity',
      media: '/admin/media',
    },
    /**
     * Sessions are HttpOnly cookies now, so no Authorization header is sent.
     * Writes carry `X-CSRF-Token` instead (see `data/apiClient.ts`).
     */
  },

  storage: {
    prefix: 'shn.admin.',
    workspace: 'workspace.v1',
    session: 'session.v1',
    credentials: 'credentials.v1',
    token: 'token.v1',
    preferences: 'preferences.v1',
  },

  /** Cached-by-default window used by the analytics screens. */
  analytics: {
    defaultRangeDays: 30,
    ranges: [7, 14, 30, 90] as const,
  },
} as const

export const DEMO_CREDENTIALS = {
  email: ADMIN_CONFIG.demo.email,
  password: ADMIN_CONFIG.demo.password,
}

export const IS_DEMO_AUTH = ADMIN_CONFIG.authMode === 'demo'

export const storageKey = (suffix: string): string => `${ADMIN_CONFIG.storage.prefix}${suffix}`
