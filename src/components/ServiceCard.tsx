import { Link } from 'react-router-dom'
import { ArrowRight, MapPin } from 'lucide-react'
import { servicePath } from '@/config/services'
import { useId } from 'react'
import { useAvailability } from '@/components/availability/AvailabilityContext'
import { ServiceIcon } from '@/components/ServiceIcon'
import { SERVICE_CATEGORIES } from '@/config/services'
import type { Service } from '@/types'

interface ServiceCardProps {
  service: Service
  /** Compact cards hide the availability button (used in tight grids). */
  compact?: boolean
}

export const ServiceCard = ({ service, compact = false }: ServiceCardProps) => {
  const { open } = useAvailability()
  const descriptionId = useId()
  const category = SERVICE_CATEGORIES.find((item) => item.id === service.category)

  return (
    <article className="card card-hover group flex h-full flex-col overflow-hidden">
      <div className="relative aspect-[16/10] overflow-hidden bg-soft">
        <img
          src={service.image}
          alt={`${service.name} service`}
          loading="lazy"
          decoding="async"
          width={1376}
          height={768}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <span className="rounded-full bg-navy-950/70 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {category?.name ?? 'Home service'}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow-sm backdrop-blur-sm dark:bg-navy-900/85 dark:text-brand-300">
            <ServiceIcon name={service.icon} className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-display text-lg font-bold leading-snug text-ink">
          <Link to={servicePath(service.slug)} className="transition-colors hover:text-brand-700 dark:hover:text-brand-300">
            {service.name}
          </Link>
        </h3>
        <p id={descriptionId} className="mt-2 flex-1 text-sm leading-6 text-muted">
          {service.shortDescription}
        </p>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
          <Link
            to={servicePath(service.slug)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
            aria-describedby={descriptionId}
          >
            Learn more
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
          {!compact ? (
            <button
              type="button"
              onClick={() => open({ serviceSlug: service.slug })}
              className="btn-secondary btn-sm"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Check availability
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
