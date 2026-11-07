import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cookie, X } from 'lucide-react'

const STORAGE_KEY = 'shn-cookie-consent'

type Consent = { essential: true; analytics: boolean; savedAt: string }

const readConsent = (): Consent | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Consent) : null
  } catch {
    return null
  }
}

/**
 * Minimal, honest consent interface. It records the visitor's choice locally and
 * exposes it for analytics loaders; no tracking script runs before consent when
 * INTEGRATIONS.analyticsRequiresConsent is true.
 */
export const CookieConsent = () => {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!readConsent()) setVisible(true)

    const reopen = () => setVisible(true)
    window.addEventListener('shn:open-cookie-consent', reopen)
    return () => window.removeEventListener('shn:open-cookie-consent', reopen)
  }, [])

  const save = (analytics: boolean) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ essential: true, analytics, savedAt: new Date().toISOString() }),
      )
    } catch {
      /* ignore storage failures */
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-title"
      aria-describedby="cookie-description"
      className="fixed inset-x-3 bottom-3 z-[60] animate-fade-up sm:inset-x-auto sm:bottom-5 sm:left-5 sm:max-w-md"
    >
      <div className="rounded-2xl border border-line bg-elevated p-4 shadow-float sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <Cookie className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cookie-title" className="font-display text-sm font-extrabold text-ink">
              Your privacy choices
            </h2>
            <p id="cookie-description" className="mt-1 text-xs leading-5 text-muted">
              We use essential storage to remember your theme and this choice. Analytics cookies are optional
              and only load if you accept them.{' '}
              <Link to="/privacy-policy" className="link">
                Privacy Policy
              </Link>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => save(true)} className="btn-primary btn-sm">
                Accept all
              </button>
              <button type="button" onClick={() => save(false)} className="btn-secondary btn-sm">
                Essential only
              </button>
              <Link to="/do-not-sell-or-share" className="px-1 py-2 text-xs font-semibold text-muted hover:text-ink">
                Do not sell or share
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={() => save(false)}
            aria-label="Dismiss and use essential storage only"
            className="-mr-1 -mt-1 rounded-full p-1.5 text-muted transition-colors hover:bg-soft hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
