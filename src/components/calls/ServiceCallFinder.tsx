import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { CALL_DIRECTORY_CATEGORIES, type CallDirectoryCategory } from '@/data/serviceNumberMapping'
import { normalizeZip, validateZip } from '@/lib/zip'
import { lookupZip, formatLocation, type UsLocation } from '@/lib/zipLookup'
import { tracking } from '@/lib/tracking'
import { servicePath } from '@/config/services'
import { ServiceIcon } from '@/components/ServiceIcon'
import { SectionHeading } from '@/components/SectionHeading'
import { CallConnectionPanel } from '@/components/calls/CallConnectionPanel'

type LookupStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ServiceCallFinderProps {
  eyebrow?: string
  title?: string
  description?: string
  className?: string
}

/**
 * ZIP-first call finder used on the homepage and the service area page.
 * Step 1 confirms the ZIP code against the national ZIP database and shows the
 * city/state; step 2 lets the visitor pick a service and see the call
 * connections authorized for that location.
 */
export const ServiceCallFinder = ({
  eyebrow = 'Find home services in your area',
  title = 'Check your ZIP code, then see the call options for your area',
  description = 'We confirm your city and state first. Then you can review the service call connections authorized for your location — or a clear message if none are confirmed yet.',
  className = '',
}: ServiceCallFinderProps) => {
  const [zip, setZip] = useState('')
  const [status, setStatus] = useState<LookupStatus>('idle')
  const [location, setLocation] = useState<UsLocation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CallDirectoryCategory | null>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const focusZip = useCallback(() => {
    zipRef.current?.focus()
    zipRef.current?.select()
  }, [])

  const runLookup = useCallback(
    async (value: string, options: { force?: boolean } = {}) => {
      const validation = validateZip(value)
      if (!validation.valid) {
        setStatus('error')
        setError(validation.message ?? 'Enter a valid 5-digit US ZIP code.')
        focusZip()
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setStatus('loading')
      setError(null)
      tracking.onZipCheck({ zip: normalizeZip(value), path: 'service-call-finder' })

      const result = await lookupZip(value, { signal: controller.signal, force: options.force })

      if (controller.signal.aborted) return

      if (result.ok) {
        setLocation(result.location)
        setStatus('ready')
        tracking.onZipResult({ zip: result.location.zip, status: 'location-confirmed' })
      } else {
        setLocation(null)
        setStatus('error')
        setError(result.message)
      }
    },
    [focusZip],
  )

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void runLookup(zip)
  }

  const reset = () => {
    abortRef.current?.abort()
    setZip('')
    setLocation(null)
    setStatus('idle')
    setError(null)
    setSelected(null)
    setTimeout(focusZip, 20)
  }

  return (
    <section className={`section bg-soft ${className}`} aria-labelledby="service-call-finder">
      <div className="container-page">
        <SectionHeading id="service-call-finder" align="center" eyebrow={eyebrow} title={title} description={description} />

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          {/* ------------------------------------------------ Step 1: ZIP */}
          <div className="card h-fit p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-2xs font-bold text-white">
                1
              </span>
              <h3 className="font-display text-base font-bold text-ink">Enter your ZIP code</h3>
            </div>

            <form onSubmit={onSubmit} noValidate className="mt-4">
              <label htmlFor="finder-zip" className="label">
                ZIP code
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <MapPin
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                    aria-hidden="true"
                  />
                  <input
                    id="finder-zip"
                    ref={zipRef}
                    value={zip}
                    onChange={(event) => {
                      setZip(normalizeZip(event.target.value))
                      if (status === 'error') {
                        setStatus(location ? 'ready' : 'idle')
                        setError(null)
                      }
                    }}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    placeholder="Enter your ZIP code"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'finder-zip-error' : 'finder-zip-hint'}
                    className={`input pl-10 tracking-[0.12em] ${error ? 'border-red-500 focus:border-red-500 focus:ring-red-500/15' : ''}`}
                  />
                </div>
                <button type="submit" disabled={status === 'loading'} className="btn-primary shrink-0 sm:px-5">
                  {status === 'loading' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" aria-hidden="true" />
                      Check ZIP
                    </>
                  )}
                </button>
              </div>
              <p id="finder-zip-hint" className="mt-1.5 text-xs text-muted">
                Five-digit US ZIP code. Example: 30301.
              </p>
              {error ? (
                <p
                  id="finder-zip-error"
                  role="alert"
                  className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => void runLookup(zip, { force: true })}
                    className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Retry
                  </button>
                </p>
              ) : null}
            </form>

            <div aria-live="polite" className="mt-4">
              {status === 'ready' && location ? (
                <div className="rounded-xl border border-success-600/25 bg-success-50/60 p-4 dark:border-success-500/25 dark:bg-success-500/10">
                  <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.14em] text-success-700 dark:text-success-300">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    ZIP code confirmed
                  </p>
                  <p className="mt-2 font-display text-lg font-extrabold text-ink">
                    {location.city}, {location.stateAbbr}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {location.state} · ZIP {location.zip}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={reset} className="btn-secondary btn-sm">
                      Change ZIP code
                    </button>
                    <Link to="/service-area" className="text-[0.8125rem] font-semibold text-brand-700 dark:text-brand-300">
                      Coverage details
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-line bg-soft p-4">
                  <p className="flex items-start gap-2 text-xs leading-5 text-muted">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                    A valid ZIP code confirms a US location. It does not by itself confirm that a phone campaign
                    accepts calls there — we check that separately before showing a number.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ------------------------------------------- Step 2: service */}
          <div className="card p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-900 text-2xs font-bold text-white">
                2
              </span>
              <h3 className="font-display text-base font-bold text-ink">Choose a service</h3>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-muted">
              {status === 'ready' && location
                ? `Showing call options for ${formatLocation(location)}.`
                : 'You can pick a service now — we will ask for your ZIP code before showing any number.'}
            </p>

            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {CALL_DIRECTORY_CATEGORIES.map((category) => {
                const isActive = selected?.groupId === category.groupId
                return (
                  <li key={category.groupId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(category)
                        if (status !== 'ready') focusZip()
                      }}
                      aria-pressed={isActive}
                      className={`group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? 'border-brand-500 bg-brand-50 dark:border-brand-400/50 dark:bg-brand-500/10'
                          : 'border-line bg-surface hover:border-brand-300 dark:hover:border-brand-500/50'
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          isActive
                            ? 'bg-brand-600 text-white'
                            : 'bg-soft text-brand-700 dark:text-brand-300'
                        }`}
                      >
                        <ServiceIcon name={category.icon} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[0.8125rem] font-bold text-ink">{category.label}</span>
                        <span className="block truncate text-2xs text-muted">{category.blurb}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div aria-live="polite">
              {selected ? (
                <div className="mt-5">
                  <CallConnectionPanel
                    serviceSlug={selected.groupId}
                    serviceName={selected.label}
                    location={location}
                    onRequestLocation={focusZip}
                    embedded
                    className="rounded-xl border border-line bg-soft/70 p-4 sm:p-5"
                  />
                  {selected.serviceSlug ? (
                    <Link
                      to={servicePath(selected.serviceSlug)}
                      className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-brand-700 dark:text-brand-300"
                    >
                      Read about {selected.label.toLowerCase()}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-line bg-soft px-4 py-3 text-xs text-muted">
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Select a service above to see its call connections.
                </p>
              )}
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <Link
                to="/services"
                className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-brand-700 dark:text-brand-300"
              >
                Looking for something else? Browse the full service directory
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
