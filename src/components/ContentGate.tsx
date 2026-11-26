/**
 * Server-first gate for the public site.
 *
 * When `VITE_API_BASE_URL` is configured the site renders **only** database
 * content: this gate holds the page back while the API datasets load, and shows
 * a retry panel if they could not be fetched. That is what makes an admin edit
 * visible on the visitor site immediately — there is no bundled copy to fall
 * back to and nothing stale to flash on screen.
 *
 * A build without an API (the static demo) skips the gate entirely.
 */
import { useEffect, type ReactNode } from 'react'
import { Loader2, ServerCrash } from 'lucide-react'
import { API_ENABLED } from '@/lib/api/client'
import { ensureApiContent } from '@/lib/api/bootstrapContent'
import { retryContent, useContentState, useContentStatus } from '@/lib/api/useContent'

export const ContentGate = ({ children }: { children: ReactNode }) => {
  const status = useContentStatus()
  const state = useContentState()

  useEffect(() => {
    if (API_ENABLED) void ensureApiContent()
  }, [])

  if (!API_ENABLED || status === 'bundled') return <>{children}</>

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand-600" aria-hidden="true" />
          <p className="text-sm font-medium text-ink">Loading the latest content…</p>
          <p className="max-w-xs text-xs text-muted">
            Every service, number and article on this page comes straight from the database.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'offline') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page px-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
            <ServerCrash className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-lg font-bold text-ink">Content is temporarily unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            We could not reach the content service, so the site is holding back rather than showing outdated
            information. Please try again in a moment.
          </p>
          {state.error ? (
            <p className="mt-3 truncate rounded-lg bg-soft px-3 py-2 font-mono text-2xs text-muted" title={state.error}>
              {state.error}
            </p>
          ) : null}
          <button type="button" onClick={retryContent} className="btn-primary mt-5 w-full">
            <Loader2 className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default ContentGate
