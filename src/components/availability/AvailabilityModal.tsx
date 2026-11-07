import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { SERVICE_CATEGORIES, SERVICES, getService, servicePath } from '@/config/services'
import { EXAMPLE_COVERAGE_DATA } from '@/config/coverage'
import { checkAvailability } from '@/lib/coverage'
import { normalizeZip, validateZip } from '@/lib/zip'
import { lookupZip, formatLocation, type UsLocation } from '@/lib/zipLookup'
import { tracking } from '@/lib/tracking'
import { ServiceIcon } from '@/components/ServiceIcon'
import { ProviderContact } from './ProviderContact'
import { CallConnectionPanel } from '@/components/calls/CallConnectionPanel'
import type { AvailabilityResult } from '@/types'

interface AvailabilityModalProps {
  isOpen: boolean
  onClose: () => void
  initialServiceSlug?: string
  initialZip?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const AvailabilityModal = ({
  isOpen,
  onClose,
  initialServiceSlug = '',
  initialZip = '',
}: AvailabilityModalProps) => {
  const [serviceSlug, setServiceSlug] = useState(initialServiceSlug)
  const [zip, setZip] = useState(initialZip)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [location, setLocation] = useState<UsLocation | null>(null)
  const [lookupNotice, setLookupNotice] = useState<string | null>(null)
  const [result, setResult] = useState<AvailabilityResult | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)

  // Reset the flow each time the dialog opens.
  useEffect(() => {
    if (!isOpen) return
    setServiceSlug(initialServiceSlug || '')
    setZip(initialZip || '')
    setError(null)
    setResult(null)
    setChecking(false)
    setLocation(null)
    setLookupNotice(null)
  }, [isOpen, initialServiceSlug, initialZip])

  // Lock scroll, handle Escape, and move focus into the dialog.
  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      if (initialServiceSlug) zipInputRef.current?.focus()
      else selectRef.current?.focus()
    }, 60)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      )
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(focusTimer)
    }
  }, [isOpen, onClose, initialServiceSlug])

  const submit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (!serviceSlug) {
        setError('Choose the service you need first.')
        selectRef.current?.focus()
        return
      }
      const validation = validateZip(zip)
      if (!validation.valid) {
        setError(validation.message ?? 'Enter a valid ZIP code.')
        zipInputRef.current?.focus()
        return
      }

      setChecking(true)
      setError(null)
      setLookupNotice(null)
      tracking.onZipCheck({ service: serviceSlug, zip: normalizeZip(zip) })

      // 1) Confirm the ZIP is a real US location (city + state).
      const lookup = await lookupZip(zip)

      // A ZIP the national database does not recognise is a hard stop.
      if (!lookup.ok && (lookup.error === 'not-found' || lookup.error === 'invalid')) {
        setChecking(false)
        setError(lookup.message)
        zipInputRef.current?.focus()
        return
      }

      setLocation(lookup.ok ? lookup.location : null)
      setLookupNotice(lookup.ok ? null : lookup.message)

      // 2) Coverage records are checked offline and still work if the lookup fails.
      const next = checkAvailability(serviceSlug, zip)
      if (!next) {
        setChecking(false)
        setError('We could not check that ZIP code. Please try again.')
        return
      }

      setChecking(false)
      setResult(next)
      tracking.onZipResult({ service: serviceSlug, zip: next.zip, status: next.status })
      window.setTimeout(() => dialogRef.current?.focus(), 30)
    },
    [serviceSlug, zip],
  )

  const retryLookup = useCallback(async () => {
    if (!result) return
    setChecking(true)
    setLookupNotice(null)
    const lookup = await lookupZip(result.zip, { force: true })
    setChecking(false)
    if (lookup.ok) {
      setLocation(lookup.location)
      setLookupNotice(null)
    } else {
      setLocation(null)
      setLookupNotice(lookup.message)
    }
  }, [result])

  const selectedService = useMemo(() => getService(serviceSlug), [serviceSlug])
  const related = useMemo(
    () => selectedService?.related.map((slug) => getService(slug)).filter(Boolean) ?? [],
    [selectedService],
  )

  if (!isOpen) return null

  const statusPanel = result
    ? {
        available: {
          icon: CheckCircle2,
          tone: 'success',
          title: 'Good News! Service Options Are Available in Your Area.',
          body: `Our coverage notes list ${result.serviceName.toLowerCase()} options for ZIP ${result.zip}. Review the call options and provider information below, or contact our team and we will help you compare what is available.`,
        },
        unavailable: {
          icon: AlertTriangle,
          tone: 'amber',
          title: "We're sorry. This service is not currently listed in your area.",
          body: `We do not have a verified ${result.serviceName.toLowerCase()} listing for ZIP ${result.zip} right now. Coverage changes as providers join, so it is worth checking again — or contact our team and we will look into nearby options.`,
        },
        unverified: {
          icon: CircleHelp,
          tone: 'brand',
          title: 'Please contact our team to confirm availability in your area.',
          body: `We have not verified ${result.serviceName.toLowerCase()} coverage for ZIP ${result.zip} yet, so we will not guess. Send us a quick message and we will confirm whether providers are listed nearby.`,
        },
      }[result.status]
    : null

  const toneClasses: Record<string, { wrap: string; icon: string }> = {
    success: {
      wrap: 'border-success-600/25 bg-success-50/70 dark:border-success-500/25 dark:bg-success-500/10',
      icon: 'bg-success-600 text-white',
    },
    amber: {
      wrap: 'border-amber-500/30 bg-amber-50/70 dark:border-amber-400/25 dark:bg-amber-400/10',
      icon: 'bg-amber-500 text-navy-950',
    },
    brand: {
      wrap: 'border-brand-500/25 bg-brand-50/70 dark:border-brand-400/25 dark:bg-brand-500/10',
      icon: 'bg-brand-600 text-white',
    },
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close availability checker"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-navy-950/60 backdrop-blur-sm animate-fade-in"
        tabIndex={-1}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="availability-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-line bg-elevated shadow-float animate-scale-in sm:max-h-[88dvh] sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-brand-600 dark:text-brand-300">
              ZIP code availability
            </p>
            <h2 id="availability-title" className="mt-1 font-display text-lg font-extrabold text-ink sm:text-xl">
              {result ? 'Availability result' : 'Check availability in your area'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted transition-colors hover:bg-soft hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          {!result ? (
            <form onSubmit={submit} noValidate>
              <p className="text-sm leading-6 text-muted">
                Service availability depends on participating providers and their coverage areas. Choose a
                service and enter a 5-digit US ZIP code to see what our records show — including the city and
                state for that ZIP.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label htmlFor="availability-service" className="label">
                    Which service do you need?
                  </label>
                  <div className="relative">
                    <select
                      id="availability-service"
                      ref={selectRef}
                      value={serviceSlug}
                      onChange={(event) => {
                        setServiceSlug(event.target.value)
                        setError(null)
                      }}
                      className="input appearance-none pr-10"
                    >
                      <option value="">Select a service…</option>
                      {SERVICE_CATEGORIES.map((category) => (
                        <optgroup key={category.id} label={category.name}>
                          {SERVICES.filter((service) => service.category === category.id).map((service) => (
                            <option key={service.slug} value={service.slug}>
                              {service.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <ServiceIcon
                      name={selectedService?.icon ?? 'wrench'}
                      className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="availability-zip" className="label">
                    Your ZIP code
                  </label>
                  <div className="relative">
                    <MapPin
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                      aria-hidden="true"
                    />
                    <input
                      id="availability-zip"
                      ref={zipInputRef}
                      value={zip}
                      onChange={(event) => {
                        setZip(normalizeZip(event.target.value))
                        setError(null)
                      }}
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="Enter your ZIP code"
                      maxLength={5}
                      aria-describedby={error ? 'availability-error' : 'availability-hint'}
                      aria-invalid={Boolean(error)}
                      className="input pl-10 tracking-[0.12em]"
                    />
                  </div>
                  <p id="availability-hint" className="mt-1.5 text-xs text-muted">
                    Example: 30301. We use your ZIP code to confirm your city and state, and to check coverage.
                  </p>
                </div>
              </div>

              {error ? (
                <p
                  id="availability-error"
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              ) : null}

              <button type="submit" disabled={checking} className="btn-primary mt-5 w-full">
                {checking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Confirming ZIP code…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" aria-hidden="true" />
                    Check Availability
                  </>
                )}
              </button>

              <p className="mt-3 text-center text-xs leading-5 text-muted">
                No obligation. Checking availability does not book a service or share your details with a
                provider.
              </p>
            </form>
          ) : (
            <div>
              <div className={`rounded-2xl border p-4 sm:p-5 ${statusPanel ? toneClasses[statusPanel.tone].wrap : ''}`}>
                <div className="flex items-start gap-3">
                  {statusPanel ? (
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClasses[statusPanel.tone].icon}`}
                    >
                      <statusPanel.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  ) : null}
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-extrabold leading-snug text-ink sm:text-lg" role="status">
                      {statusPanel?.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted">{statusPanel?.body}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="chip">
                  <ServiceIcon name={selectedService?.icon ?? 'wrench'} className="h-3.5 w-3.5" />
                  {result.serviceName}
                </span>
                <span className="chip">
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  {location ? `ZIP ${result.zip} · ${formatLocation(location)}` : `ZIP ${result.zip}`}
                </span>
                {location ? (
                  <span className="chip">
                    {location.state} ({location.stateAbbr})
                  </span>
                ) : null}
                {result.dataSource === 'example' ? (
                  <span className="chip border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
                    Example coverage data
                  </span>
                ) : null}
              </div>

              {lookupNotice ? (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">
                    We could not confirm your city and state just now: {lookupNotice} Coverage below still
                    reflects our records for ZIP {result.zip}.
                  </span>
                  <button
                    type="button"
                    onClick={() => void retryLookup()}
                    disabled={checking}
                    className="inline-flex shrink-0 items-center gap-1 font-semibold underline underline-offset-2"
                  >
                    <RefreshCw className={`h-3 w-3 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Retry
                  </button>
                </div>
              ) : null}

              {/* Call connections for this service + confirmed location */}
              <div className="mt-5">
                <CallConnectionPanel
                  serviceSlug={result.serviceSlug}
                  serviceName={result.serviceName}
                  location={location}
                  embedded
                />
              </div>

              {result.providers.length > 0 ? (
                <div className="mt-5">
                  <ProviderContact
                    serviceSlug={result.serviceSlug}
                    serviceName={result.serviceName}
                    zip={result.zip}
                    providers={result.providers}
                  />
                </div>
              ) : null}

              {result.status === 'unavailable' && related.length > 0 ? (
                <div className="mt-5 rounded-xl border border-line bg-soft p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                    Related services to try
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {related.map((service) =>
                      service ? (
                        <Link
                          key={service.slug}
                          to={servicePath(service.slug)}
                          onClick={onClose}
                          className="group flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:text-brand-700 dark:hover:border-brand-500/50 dark:hover:text-brand-300"
                        >
                          <span className="flex items-center gap-2">
                            <ServiceIcon name={service.icon} className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                            {service.name}
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      ) : null,
                    )}
                  </div>
                </div>
              ) : null}

              {result.status === 'unverified' ? (
                <div className="mt-5 rounded-xl border border-line bg-soft p-4 text-sm leading-6 text-muted">
                  <p className="font-semibold text-ink">Why we ask you to contact us</p>
                  <p className="mt-1">
                    We only confirm availability from verified coverage records. Rather than guess, our team
                    will check whether a provider is listed near {result.zip} and get back to you.
                  </p>
                </div>
              ) : null}

              {result.dataSource === 'example' && EXAMPLE_COVERAGE_DATA ? (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Coverage results on this site currently use a sample dataset for demonstration. Replace
                  <code className="mx-1 rounded bg-black/5 px-1 dark:bg-white/10">src/config/coverage.ts</code>
                  with your contracted coverage before launch.
                </p>
              ) : null}

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setResult(null)
                    setError(null)
                    setLocation(null)
                    setLookupNotice(null)
                  }}
                  className="btn-secondary flex-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Check another ZIP
                </button>
                <Link to="/contact" onClick={onClose} className="btn-primary flex-1">
                  Contact our team
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 w-full rounded-lg py-2 text-sm font-semibold text-muted transition-colors hover:text-ink"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
