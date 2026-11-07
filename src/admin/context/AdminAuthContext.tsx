/**
 * Demo authentication.
 *
 * ⚠️  This is a *client-side demo*. There is no server, so there is no real
 *     security: the credentials ship in the bundle. It exists to demonstrate the
 *     full flow (login → protected routes → session expiry → logout) so the
 *     Phase 2 PHP + MySQL auth can drop straight into the same context API.
 *
 * Session shape mirrors what a PHP session endpoint will return.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ADMIN_CONFIG, IS_DEMO_AUTH, storageKey } from '@/admin/config/adminConfig'
import type { AdminCredentials, AdminSession, AdminUser } from '@/admin/types/admin'
import { readJSON, storage, writeJSON } from '@/admin/data/storage'

const SESSION_KEY = storageKey(ADMIN_CONFIG.storage.session)
const CREDENTIALS_KEY = storageKey(ADMIN_CONFIG.storage.credentials)

interface StoredCredentials {
  email: string
  password: string
}

interface AuthContextValue {
  user: AdminUser | null
  session: AdminSession | null
  isAuthenticated: boolean
  isDemo: boolean
  signIn: (credentials: AdminCredentials) => Promise<AdminSession>
  signOut: (reason?: string) => void
  updateProfile: (patch: Partial<Pick<AdminUser, 'name' | 'email' | 'initials'>>) => void
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  extendSession: () => void
  /** Populated when a session ends on its own (expiry) rather than by the user. */
  lastSignOutReason: string | null
  signOutReason: string | null
}

const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * The credentials that currently work. Starts as ADMIN_CONFIG.demo and can be
 * changed from Profile → Change password (demo only, stored per browser).
 */
export const readDemoCredentials = (): StoredCredentials => getCredentials()

const getCredentials = (): StoredCredentials =>
  readJSON<StoredCredentials>(CREDENTIALS_KEY, {
    email: ADMIN_CONFIG.demo.email,
    password: ADMIN_CONFIG.demo.password,
  })

const buildSession = (email: string): AdminSession => {
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + ADMIN_CONFIG.demo.sessionHours * 60 * 60 * 1000)
  return {
    token: `demo_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    user: {
      id: 'admin_demo',
      name: ADMIN_CONFIG.demo.name,
      email,
      role: ADMIN_CONFIG.demo.role,
      initials: ADMIN_CONFIG.demo.initials,
    },
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}

const readSession = (): AdminSession | null => {
  const session = readJSON<AdminSession | null>(SESSION_KEY, null)
  if (!session?.token || !session.user) return null
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    storage.remove(SESSION_KEY)
    return null
  }
  return session
}

export const AdminAuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AdminSession | null>(() => readSession())
  const [signOutReason, setSignOutReason] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const signOut = useCallback((reason?: string) => {
    storage.remove(SESSION_KEY)
    setSession(null)
    setSignOutReason(reason ?? null)
  }, [])

  // Expire the session the moment it lapses, even with no navigation.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!session) return
    const remaining = new Date(session.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      signOut('Your session expired. Sign in again to continue.')
      return
    }
    timerRef.current = setTimeout(() => signOut('Your session expired. Sign in again to continue.'), Math.min(remaining, 2_147_483_647))
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [session, signOut])

  const signIn = useCallback(async (credentials: AdminCredentials): Promise<AdminSession> => {
    const expected = getCredentials()
    // Simulated network latency for a realistic submit state.
    await new Promise((resolve) => setTimeout(resolve, 420))

    const emailMatches = credentials.email.trim().toLowerCase() === expected.email.trim().toLowerCase()
    const passwordMatches = credentials.password === expected.password

    if (!emailMatches || !passwordMatches) {
      throw new Error('Incorrect email or password. Check the demo credentials shown below the form.')
    }

    const next = buildSession(expected.email)
    writeJSON(SESSION_KEY, next)
    setSession(next)
    setSignOutReason(null)
    return next
  }, [])

  const updateProfile = useCallback((patch: Partial<Pick<AdminUser, 'name' | 'email' | 'initials'>>) => {
    setSession((current) => {
      if (!current) return current
      const next: AdminSession = { ...current, user: { ...current.user, ...patch } }
      writeJSON(SESSION_KEY, next)
      return next
    })
  }, [])

  const changePassword = useCallback(async (currentPassword: string, nextPassword: string) => {
    const expected = getCredentials()
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (currentPassword !== expected.password) {
      throw new Error('The current password does not match the demo credentials.')
    }
    if (nextPassword.length < 8) {
      throw new Error('Use at least 8 characters for the new password.')
    }
    writeJSON(CREDENTIALS_KEY, { ...expected, password: nextPassword })
  }, [])

  const extendSession = useCallback(() => {
    setSession((current) => {
      if (!current) return current
      const next: AdminSession = {
        ...current,
        expiresAt: new Date(Date.now() + ADMIN_CONFIG.demo.sessionHours * 60 * 60 * 1000).toISOString(),
      }
      writeJSON(SESSION_KEY, next)
      return next
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      isAuthenticated: Boolean(session),
      isDemo: IS_DEMO_AUTH,
      signIn,
      signOut,
      updateProfile,
      changePassword,
      extendSession,
      lastSignOutReason: signOutReason,
      signOutReason,
    }),
    [session, signIn, signOut, updateProfile, changePassword, extendSession, signOutReason],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAdminAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAdminAuth must be used inside <AdminAuthProvider>')
  return context
}

export const ADMIN_SESSION_KEY = SESSION_KEY
