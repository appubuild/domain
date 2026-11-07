/**
 * ============================================================================
 *  ADMIN CONFIGURATION — PHASE 1 (STATIC DEMO)
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
 *  Change the demo email / password here. The login screen reads them from
 *  this object, so the placeholders it shows always match what works.
 * ============================================================================
 */

export type AuthMode = 'demo' | 'api'

export const ADMIN_CONFIG = {
  version: '1.0.0-phase1',
  product: {
    name: 'Safe Home Network',
    consoleName: 'Admin Console',
    tagline: 'Directory, content and call tracking',
  },

  /** `demo` = client-side check against the credentials below. */
  authMode: 'demo' as AuthMode,

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
   * Phase 2 placeholders. Nothing here is called yet: the repository always
   * runs against local mock storage while `enabled` is false.
   */
  api: {
    enabled: false,
    baseUrl: '', // e.g. 'https://safehomenetwork.com/api'
    version: 'v1',
    timeoutMs: 15000,
    endpoints: {
      login: '/auth/login',
      logout: '/auth/logout',
      session: '/auth/session',
      services: '/services',
      numbers: '/numbers',
      niches: '/niches',
      pages: '/pages',
      posts: '/posts',
      sections: '/homepage-sections',
      leads: '/leads',
      settings: '/settings',
      seo: '/seo',
      analytics: '/analytics',
    },
    /** Auth header used by the future API client. */
    authHeader: 'Authorization',
    authScheme: 'Bearer ',
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
