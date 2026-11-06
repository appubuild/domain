import { Link } from 'react-router-dom'
import { ArrowUpRight, BadgeCheck, Info, Mail, Phone } from 'lucide-react'
import { SITE, hasPhone, telHref } from '@/config/site'
import { tracking } from '@/lib/tracking'
import type { Provider } from '@/types'

interface ProviderContactProps {
  serviceSlug: string
  serviceName: string
  zip: string
  providers: Provider[]
}

const AvailabilityBadge = ({ status }: { status: Provider['availability'] }) => {
  const map = {
    available: {
      label: 'Accepting inquiries',
      className:
        'border-success-600/25 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300',
    },
    limited: {
      label: 'Limited availability',
      className:
        'border-amber-500/30 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
    },
    unavailable: {
      label: 'Not accepting inquiries',
      className: 'border-line bg-soft text-muted',
    },
  }[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide ${map.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {map.label}
    </span>
  )
}

const ProviderCard = ({
  provider,
  serviceName,
  zip,
}: {
  provider: Provider
  serviceName: string
  zip: string
}) => {
  const number = provider.trackingNumber || provider.phone

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-ink">{provider.name}</h4>
          <p className="mt-0.5 text-sm text-muted">{serviceName} · Serves {zip}</p>
        </div>
        <AvailabilityBadge status={provider.availability} />
      </div>

      {provider.credentialNote ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-muted">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden="true" />
          <span>{provider.credentialNote}</span>
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {number ? (
          <a
            href={`tel:${number}`}
            onClick={() => tracking.onCallIntent({ service: serviceName, zip, providerId: provider.id })}
            className="btn-primary btn-sm"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call Now
          </a>
        ) : null}
        {provider.website ? (
          <a
            href={provider.website}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="btn-secondary btn-sm"
          >
            Visit website
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
        <Link to="/contact" className="btn-secondary btn-sm">
          <Mail className="h-4 w-4" aria-hidden="true" />
          Request contact
        </Link>
      </div>

      <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">{provider.disclosure}</p>
    </div>
  )
}

/**
 * Reusable provider connection block.
 * Renders real provider records when configured; otherwise a clear fallback that
 * never invents a phone number.
 */
export const ProviderContact = ({ serviceSlug, serviceName, zip, providers }: ProviderContactProps) => {
  if (providers.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-soft p-5 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          <Phone className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-3 font-display text-base font-bold text-ink">
          Contact our team to explore available service options
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted">
          We do not publish provider phone numbers for every area yet. Tell us what you need and we will
          help you review the {serviceName.toLowerCase()} options listed near {zip}.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Link to="/contact" className="btn-primary btn-sm">
            Contact our team
          </Link>
          {hasPhone() ? (
            <a
              href={telHref() as string}
              onClick={() => tracking.onCallIntent({ service: serviceSlug, zip })}
              className="btn-secondary btn-sm"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              {SITE.contact.phoneDisplay}
            </a>
          ) : (
            <a href={`mailto:${SITE.contact.email}`} className="btn-secondary btn-sm">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email us
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        <BadgeCheck className="h-4 w-4 text-brand-500" aria-hidden="true" />
        Participating provider options
      </div>
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} serviceName={serviceName} zip={zip} />
      ))}
      <p className="flex items-start gap-2 text-xs leading-5 text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {SITE.name} is a connection platform. Providers are independent businesses; availability, pricing
        and scheduling are set by the provider.
      </p>
    </div>
  )
}
