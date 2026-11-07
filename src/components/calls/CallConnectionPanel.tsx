import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
} from 'lucide-react'
import { SITE, hasPhone, telHref } from '@/config/site'
import { tracking } from '@/lib/tracking'
import { resolveCallDirectory } from '@/lib/phoneDirectory'
import type { ResolvedCallNumber } from '@/lib/phoneDirectory'
import type { UsLocation } from '@/lib/zipLookup'
import { formatLocation } from '@/lib/zipLookup'

interface CallConnectionPanelProps {
  serviceSlug: string
  serviceName: string
  location?: UsLocation | null
  /** Opens the ZIP flow (availability dialog) when a location is required. */
  onRequestLocation?: () => void
  /** Hides the outer card chrome when nested inside another card. */
  embedded?: boolean
  className?: string
}

const ContactFallback = ({
  serviceName,
  title,
  body,
  onRequestLocation,
}: {
  serviceName: string
  title: string
  body: string
  onRequestLocation?: () => void
}) => (
  <div className="rounded-xl border border-dashed border-line bg-soft p-5">
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-sm font-bold text-ink">{title}</p>
        <p className="mt-1 text-[0.8125rem] leading-6 text-muted">
          {body.replace('{service}', serviceName.toLowerCase())}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link to="/contact" className="btn-primary btn-sm">
            Contact our team
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          {onRequestLocation ? (
            <button type="button" onClick={onRequestLocation} className="btn-secondary btn-sm">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Check my ZIP code
            </button>
          ) : (
            <a href={`mailto:${SITE.contact.email}`} className="btn-secondary btn-sm">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Email us
            </a>
          )}
          {hasPhone() ? (
            <a href={telHref() as string} className="btn-secondary btn-sm">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              {SITE.contact.phoneDisplay}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  </div>
)

const NumberCard = ({
  number,
  serviceSlug,
  location,
}: {
  number: ResolvedCallNumber
  serviceSlug: string
  location?: UsLocation | null
}) => {
  const isPrimary = number.slot === 'primary'
  const actionLabel = isPrimary ? 'Call Now' : 'Call Alternate'
  const connectionLabel = isPrimary ? 'Primary call connection' : 'Alternate call connection'

  return (
    <div
      className={`flex h-full flex-col rounded-xl border p-4 ${
        isPrimary
          ? 'border-brand-500/40 bg-brand-50/50 dark:border-brand-400/30 dark:bg-brand-500/10'
          : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">{connectionLabel}</p>
        {!number.published ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
            Not published
          </span>
        ) : null}
      </div>

      <p className="mt-2 font-display text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
        {number.display}
      </p>
      <p className="mt-1 text-xs text-muted">
        {location ? `For ZIP ${location.zip} · ${formatLocation(location)}` : 'Toll-free service line'}
      </p>

      <a
        href={number.telHref}
        onClick={() =>
          tracking.onCallIntent({
            service: serviceSlug,
            zip: location?.zip,
            providerId: number.id,
          })
        }
        aria-label={`${actionLabel} — ${number.display}`}
        className={`${isPrimary ? 'btn-primary' : 'btn-secondary'} mt-4 w-full`}
      >
        <Phone className="h-4 w-4" aria-hidden="true" />
        {actionLabel}
        <span aria-hidden="true" className="font-normal opacity-80">
          — {number.display}
        </span>
      </a>

      {number.network ? <p className="mt-2 text-2xs text-muted">Network: {number.network}</p> : null}
    </div>
  )
}

/**
 * The single component the whole site uses to offer a phone connection.
 * It only ever renders numbers the directory says are publishable for the
 * visitor's confirmed location — never a number from another trade, never an
 * unpublished number (except a clearly-labelled local preview).
 */
export const CallConnectionPanel = ({
  serviceSlug,
  serviceName,
  location,
  onRequestLocation,
  embedded = false,
  className = '',
}: CallConnectionPanelProps) => {
  const state = resolveCallDirectory({ serviceSlug, serviceName, location })
  const wrapper = embedded
    ? className
    : `rounded-2xl border border-line bg-elevated p-5 shadow-card sm:p-6 ${className}`

  const heading = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          Call connection
        </p>
        <h3 className="mt-1 font-display text-base font-extrabold text-ink">{state.label}</h3>
      </div>
      {state.kind === 'ready' ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success-600/25 bg-success-50 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Authorized line
        </span>
      ) : null}
    </div>
  )

  if (state.kind === 'no-directory') {
    return (
      <div className={wrapper}>
        {heading}
        <div className="mt-4">
          <ContactFallback
            serviceName={serviceName}
            title={`No published phone line for ${state.label.toLowerCase()} yet`}
            body="We do not publish a call connection for {service} yet. Contact our team and we will help you review the options listed for your area."
            onRequestLocation={onRequestLocation}
          />
        </div>
      </div>
    )
  }

  if (state.kind === 'awaiting-verification') {
    return (
      <div className={wrapper}>
        {heading}
        <div className="mt-4">
          <ContactFallback
            serviceName={serviceName}
            title="Call connections are being finalized"
            body="The service line for {service} is not published yet while it is being verified. Contact our team and we will point you to an available option."
            onRequestLocation={onRequestLocation}
          />
        </div>
        <p className="mt-3 flex items-start gap-2 text-2xs leading-5 text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Numbers are only published after they and their call-campaign terms have been verified.
        </p>
      </div>
    )
  }

  if (state.kind === 'needs-location') {
    return (
      <div className={wrapper}>
        {heading}
        <div className="mt-4 rounded-xl border border-line bg-soft p-5">
          <p className="flex items-start gap-2 font-display text-sm font-bold text-ink">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            Confirm your ZIP code to see call options
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted">
            Phone campaigns are permissioned by location. Enter your ZIP code and we will show the call
            connections authorized for your area — or tell you plainly that none are confirmed yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {onRequestLocation ? (
              <button type="button" onClick={onRequestLocation} className="btn-primary btn-sm">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Check my ZIP code
              </button>
            ) : (
              <Link to="/service-area" className="btn-primary btn-sm">
                Check availability
              </Link>
            )}
            <Link to="/contact" className="btn-secondary btn-sm">
              Contact our team
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'unverified-location') {
    return (
      <div className={wrapper}>
        {heading}
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-50/70 p-5 dark:border-amber-400/25 dark:bg-amber-400/10">
          <p className="flex items-start gap-2 font-display text-sm font-bold text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            We cannot confirm this campaign accepts calls from {formatLocation(state.location)}
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-amber-900/85 dark:text-amber-100/85">
            ZIP {state.location.zip} is a valid US location, but a valid ZIP code is not the same as campaign
            eligibility. Rather than connect you to a line that may not serve your area, our team will confirm
            an option for you.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/contact" className="btn-primary btn-sm">
              Contact our team
            </Link>
            <a href={`mailto:${SITE.contact.email}`} className="btn-secondary btn-sm">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Email us
            </a>
          </div>
        </div>
      </div>
    )
  }

  const numbers = state.numbers
  const preview = state.kind === 'preview'

  return (
    <div className={wrapper}>
      {heading}

      {preview ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-50/70 px-3 py-2 text-2xs leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Local preview only — these numbers are pending verification and are hidden from visitors in the
          live site.
        </p>
      ) : null}

      <div className={`mt-4 grid gap-3 ${numbers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {numbers.map((number) => (
          <NumberCard
            key={number.id}
            number={number}
            serviceSlug={serviceSlug}
            location={'location' in state ? state.location : null}
          />
        ))}
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <p className="flex items-start gap-2 text-2xs leading-5 text-muted">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          Each button dials its own number — calls are never auto-connected or forwarded to another line. Calls
          are answered by independent participating providers; {SITE.name} is a connection platform and does
          not perform the work.
        </p>
        <p className="flex items-start gap-2 text-2xs leading-5 text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Ask the provider for their license number, insurance and written scope before authorizing work.
        </p>
      </div>
    </div>
  )
}
