import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Phone } from 'lucide-react'
import { CALL_DIRECTORY_CATEGORIES } from '@/data/serviceNumberMapping'
import { ServiceIcon } from '@/components/ServiceIcon'
import { CallConnectionPanel } from './CallConnectionPanel'
import { servicePath } from '@/config/services'

interface ServiceCallDirectoryProps {
  eyebrow?: string
  title?: string
  description?: string
  className?: string
}

/**
 * "Select a service → Call Now" in one section.
 *
 * No ZIP code, no availability check: choosing a category immediately reveals
 * that category's published call connections. Until something is selected, the
 * panel shows a prompt and no phone number is rendered anywhere.
 */
export const ServiceCallDirectory = ({
  eyebrow = 'Call a service line',
  title = 'Choose a service, then call the line assigned to it',
  description = 'Pick the trade you need. We show the primary and alternate call connections for that service — tap once and your phone dials.',
  className = '',
}: ServiceCallDirectoryProps) => {
  const [selected, setSelected] = useState<string>('')
  const active = CALL_DIRECTORY_CATEGORIES.find((category) => category.groupId === selected)

  return (
    <section className={`section ${className}`} aria-labelledby="call-directory-heading">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow mx-auto inline-flex">{eyebrow}</p>
          <h2
            id="call-directory-heading"
            className="mt-4 font-display text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl"
          >
            {title}
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-7 text-muted">{description}</p>
        </div>

        <div className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {CALL_DIRECTORY_CATEGORIES.map((category) => {
            const isActive = category.groupId === selected
            return (
              <button
                key={category.groupId}
                type="button"
                onClick={() => setSelected(category.groupId)}
                aria-pressed={isActive}
                className={`group flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-all ${
                  isActive
                    ? 'border-brand-500 bg-brand-50 shadow-card ring-1 ring-brand-500/30 dark:border-brand-400/60 dark:bg-brand-500/10'
                    : 'border-line bg-surface hover:border-brand-300 hover:shadow-card dark:hover:border-brand-500/50'
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                  }`}
                >
                  <ServiceIcon name={category.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold text-ink">{category.label}</span>
                  <span className="mt-0.5 block truncate text-2xs text-muted">{category.blurb}</span>
                </span>
                <Phone
                  className={`h-4 w-4 shrink-0 ${isActive ? 'text-brand-600 dark:text-brand-300' : 'text-muted'}`}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>

        <div className="mx-auto mt-6 max-w-3xl" aria-live="polite">
          {active ? (
            <div className="card p-5 shadow-card sm:p-6">
              <CallConnectionPanel
                serviceSlug={active.groupId}
                serviceName={active.label}
                embedded
              />
              {active.serviceSlug ? (
                <div className="mt-3 text-right">
                  <Link
                    to={servicePath(active.serviceSlug)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
                  >
                    More about {active.label.toLowerCase()}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-soft px-4 py-5 text-center text-sm text-muted">
              Select a service above to see its call connections.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
