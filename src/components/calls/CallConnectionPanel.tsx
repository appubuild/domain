import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, Info, Mail, MessageSquare, Phone, ShieldCheck } from 'lucide-react'
import { SITE, hasPhone, telHref } from '@/config/site'
import { tracking } from '@/lib/tracking'
import { resolveServiceCall } from '@/lib/phoneDirectory'
import type { ResolvedCallNumber } from '@/lib/phoneDirectory'

interface CallConnectionPanelProps {
  serviceSlug: string
  serviceName: string
  /** Hides the outer card chrome when nested inside another card or dialog. */
  embedded?: boolean
  className?: string
}

const ContactFallback = ({
  serviceName,
  title,
  body,
}: {
  serviceName: string
  title: string
  body: string
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
          <a href={`mailto:${SITE.contact.email}`} className="btn-secondary btn-sm">
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Email us
          </a>
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
}: {
  number: ResolvedCallNumber
  serviceSlug: string
}) => {
  const isPrimary = number.slot === 'primary'
  const actionLabel = isPrimary ? 'Call Now' : 'Call Alternate'

  return (
    <div
      className={`flex h-full flex-col rounded-xl border p-4 ${
        isPrimary
          ? 'border-brand-500/40 bg-brand-50/50 shadow-sm dark:border-brand-400/30 dark:bg-brand-500/10'
          : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">
          {isPrimary ? 'Primary line' : 'Alternate line'}
        </p>
        {!number.published ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">
            Not published
          </span>
        ) : null}
      </div>

      <p className="mt-2 font-display text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
        {number.display}
      </p>

      <a
        href={number.telHref}
        onClick={() =>
          tracking.onCallIntent({
            service: serviceSlug,
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
    </div>
  )
}

/**
 * The one component that turns a selected service into call buttons.
 *
 * It renders only the numbers the directory assigns to that service (primary
 * first, then alternates) and never shows a number for any other trade. When
 * nothing is published for the service it shows a contact message instead of a
 * guess.
 */
export const CallConnectionPanel = ({
  serviceSlug,
  serviceName,
  embedded = false,
  className = '',
}: CallConnectionPanelProps) => {
  const state = resolveServiceCall({ serviceSlug, serviceName })
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
          />
        </div>
        <p className="mt-3 flex items-start gap-2 text-2xs leading-5 text-muted">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          Numbers are only published after the line and its call permissions have been verified.
        </p>
      </div>
    )
  }

  const { numbers } = state
  const preview = state.kind === 'preview'

  return (
    <div className={wrapper}>
      {heading}

      {preview ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-50/70 px-3 py-2 text-2xs leading-5 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          Local preview only — these numbers are pending verification and are hidden from visitors in the
          live site.
        </p>
      ) : null}

      <div className={`mt-4 grid gap-3 ${numbers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {numbers.map((number) => (
          <NumberCard key={number.id} number={number} serviceSlug={serviceSlug} />
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
