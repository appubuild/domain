import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, KeyRound, LogOut, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react'
import { useAdminAuth } from '@/admin/context/AdminAuthContext'
import { repository } from '@/admin/data/repository'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import type { ActivityEntry } from '@/admin/types/admin'
import { formatDateTime, initialsOf, timeAgo } from '@/admin/lib/format'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

export const ProfilePage = () => {
  const toast = useToast()
  const { user, session, updateProfile, changePassword, extendSession, signOut } = useAdminAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])

  const loadActivity = useCallback(() => {
    repository
      .listActivity()
      .then(setActivity)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    loadActivity()
  }, [loadActivity])

  const remaining = useMemo(() => {
    if (!session) return '—'
    const ms = new Date(session.expiresAt).getTime() - Date.now()
    if (ms <= 0) return 'expired'
    const hours = Math.floor(ms / 3_600_000)
    const minutes = Math.floor((ms % 3_600_000) / 60_000)
    return `${hours}h ${minutes}m`
  }, [session])

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault()
    updateProfile({ name: name.trim(), email: email.trim(), initials: initialsOf(name.trim()) || 'DA' })
    toast.success('Profile updated', 'The change applies to this demo session.')
  }

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordError(null)
    if (nextPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }
    setSavingPassword(true)
    try {
      await changePassword(currentPassword, nextPassword)
      toast.success('Password changed', 'Use the new password the next time you sign in.')
      setCurrentPassword('')
      setNextPassword('')
      setConfirmPassword('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not change the password.'
      setPasswordError(message)
      toast.error('Password not changed', message)
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profile & security"
        description="Your admin identity, session and recent console activity."
        meta={<Badge tone="amber">Demo authentication</Badge>}
        actions={
          <Button variant="secondary" size="sm" onClick={() => signOut('You signed out.')} iconLeft={<LogOut className="h-4 w-4" />}>
            Sign out
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Administrator" description="Displayed in the topbar and activity log." action={<UserRound className="h-4 w-4 text-muted" />} />
            <form onSubmit={saveProfile} className="space-y-3 p-5">
              <div className="flex items-center gap-3">
                <Avatar initials={user?.initials ?? 'DA'} className="h-12 w-12 text-sm" />
                <div>
                  <p className="font-display text-sm font-bold text-ink">{user?.name}</p>
                  <p className="text-2xs text-muted">
                    {user?.role} · {user?.email}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" htmlFor="profile-name">
                  <Input id="profile-name" value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Email address" htmlFor="profile-email">
                  <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm">
                  Save profile
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader title="Change password" description="Stored in this browser only while demo mode is on." action={<KeyRound className="h-4 w-4 text-muted" />} />
            <form onSubmit={savePassword} className="space-y-3 p-5">
              {passwordError ? (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
                  {passwordError}
                </p>
              ) : null}
              <Field label="Current password" htmlFor="profile-current">
                <Input
                  id="profile-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="New password" htmlFor="profile-next" hint="At least 8 characters.">
                  <Input
                    id="profile-next"
                    type="password"
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(event) => setNextPassword(event.target.value)}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="profile-confirm">
                  <Input
                    id="profile-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" loading={savingPassword}>
                  Update password
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Session" description="Demo sessions expire automatically." action={<Clock className="h-4 w-4 text-muted" />} />
            <dl className="divide-y divide-line text-xs">
              {[
                { label: 'Signed in', value: session ? formatDateTime(session.issuedAt) : '—' },
                { label: 'Expires', value: session ? formatDateTime(session.expiresAt) : '—' },
                { label: 'Time remaining', value: remaining },
                { label: 'Session length', value: `${ADMIN_CONFIG.demo.sessionHours} hours` },
                { label: 'Token', value: session ? `${session.token.slice(0, 14)}…` : '—' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="font-medium text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  extendSession()
                  toast.success('Session extended', `${ADMIN_CONFIG.demo.sessionHours} more hours.`)
                }}
              >
                Extend session
              </Button>
              <Button variant="danger" size="sm" onClick={() => signOut('You signed out.')} iconLeft={<LogOut className="h-3.5 w-3.5" />}>
                Sign out
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Security model" description="What is and is not protected in Phase 1." action={<ShieldAlert className="h-4 w-4 text-amber-500" />} />
            <div className="space-y-2.5 p-5 text-xs leading-relaxed text-muted">
              <p className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" />
                Protected routes redirect unauthenticated visitors to the sign-in screen, sessions expire, and
                signing out clears the stored session.
              </p>
              <p className="flex gap-2">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                Demo credentials live in the JavaScript bundle, so this is not real access control. There is no
                server to validate a password and no audit trail outside this browser.
              </p>
              <p className="rounded-lg bg-soft px-3 py-2 text-2xs">
                Phase 2 replaces this with PHP sessions, hashed passwords, CSRF protection, rate limiting and
                server-side authorisation on every admin endpoint.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Recent activity" description="The last actions taken in this demo workspace." />
        <ul className="divide-y divide-line">
          {activity.slice(0, 10).map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-xs">
              <span className="font-semibold text-ink">{entry.action}</span>
              <span className="text-muted">{entry.target}</span>
              <span className="ml-auto text-2xs text-muted">
                {entry.actor} · {timeAgo(entry.at)}
              </span>
            </li>
          ))}
          {activity.length === 0 ? <li className="px-5 py-4 text-xs text-muted">No activity recorded yet.</li> : null}
        </ul>
      </Card>
    </div>
  )
}
