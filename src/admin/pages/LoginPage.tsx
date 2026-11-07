import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { readDemoCredentials, useAdminAuth } from '@/admin/context/AdminAuthContext'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import { Button, Field, Input } from '@/admin/components/ui'

export const LoginPage = () => {
  const { signIn, isAuthenticated, lastSignOutReason } = useAdminAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  // Reflects a password changed from the profile screen in this browser.
  const [demo] = useState(readDemoCredentials)

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/admin'

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true })
  }, [isAuthenticated, navigate, redirectTo])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn({ email, password })
      navigate(redirectTo, { replace: true })
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  const fillDemo = () => {
    setEmail(demo.email)
    setPassword(demo.password)
    setError(null)
  }

  const copyDemo = async () => {
    try {
      await navigator.clipboard.writeText(`${demo.email} / ${demo.password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-page lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-navy-950 px-10 py-12 text-navy-100 lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(60% 60% at 20% 10%, rgba(37,99,235,0.45), transparent 60%), radial-gradient(50% 50% at 90% 80%, rgba(124,58,237,0.35), transparent 60%)',
          }}
        />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 font-display text-base font-extrabold text-white">
              SH
            </span>
            <span>
              <span className="block font-display text-base font-bold text-white">Safe Home Network</span>
              <span className="block text-2xs uppercase tracking-[0.18em] text-navy-300">
                {ADMIN_CONFIG.product.consoleName}
              </span>
            </span>
          </Link>

          <h1 className="mt-14 max-w-md font-display text-4xl font-bold leading-[1.1] text-white">
            One console for the directory, the content and the call lines.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-navy-300">
            Manage the fifteen service categories, the twenty tracked numbers, pages, posts and the
            homepage — then review call performance in one place.
          </p>

          <ul className="mt-9 space-y-3 text-sm text-navy-200">
            {[
              'Service and tracking-number management',
              'Pages, blog and homepage sections',
              'Call, traffic and revenue reporting',
              'Settings, SEO and security',
            ].map((line) => (
              <li key={line} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600/25 text-brand-300 ring-1 ring-brand-500/40">
                  <ShieldCheck className="h-3 w-3" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
          <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-[0.14em] text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" /> Phase 1 · static demo
          </p>
          <p className="mt-2 text-xs leading-relaxed text-navy-300">
            Authentication, data and analytics are simulated in the browser. The PHP + MySQL API and
            real session security arrive in Phase 2.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 font-display text-sm font-extrabold text-white">
              SH
            </span>
            <span>
              <span className="block font-display text-sm font-bold text-ink">Safe Home Network</span>
              <span className="block text-2xs uppercase tracking-[0.16em] text-muted">Admin Console</span>
            </span>
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">Sign in to the console</h2>
          <p className="mt-1.5 text-sm text-muted">
            Use the demo credentials below. They are prefilled with one click.
          </p>

          {lastSignOutReason ? (
            <div
              role="status"
              className="mt-5 rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-700/50 dark:bg-amber-600/10 dark:text-amber-200"
            >
              {lastSignOutReason}
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <Field label="Email address" htmlFor="admin-email" required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  placeholder={demo.email}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                  required
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="admin-password" required>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition hover:bg-soft hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={loading} className="w-full" iconRight={<ArrowRight className="h-4 w-4" />}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 rounded-2xl border border-dashed border-line bg-soft/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-muted">
                <KeyRound className="h-3.5 w-3.5" /> Demo credentials
              </p>
              <button
                type="button"
                onClick={copyDemo}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-semibold text-brand-700 transition hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/40"
              >
                <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <dl className="mt-2.5 space-y-1 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd className="font-mono text-[0.72rem] font-medium text-ink">{demo.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Password</dt>
                <dd className="font-mono text-[0.72rem] font-medium text-ink">{demo.password}</dd>
              </div>
            </dl>
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={fillDemo}>
              Fill demo credentials
            </Button>
            <p className="mt-2.5 text-2xs leading-relaxed text-muted">{ADMIN_CONFIG.demo.notice}</p>
          </div>

          <p className="mt-6 text-center text-2xs text-muted">
            <Link to="/" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              ← Back to the public website
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
