import { Link } from 'react-router-dom'
import { ArrowRight, Info, MapPin, MessageSquare } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SERVICES, servicePath } from '@/config/services'
import { coverageSummary } from '@/config/coverage'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { ZipCheckForm } from '@/components/availability/ZipCheckForm'
import { useAvailability } from '@/components/availability/AvailabilityContext'
import { ServiceIcon } from '@/components/ServiceIcon'
import { CtaBand } from '@/components/CtaBand'
import { LaunchNotice } from '@/components/LaunchNotice'
import { SITE } from '@/config/site'

const ServiceArea = () => {
  const { open } = useAvailability()

  useSeo({
    title: 'Service Area & ZIP Code Coverage',
    description:
      'Check which home services are listed in your ZIP code. Coverage varies by service and by participating provider — confirm availability before you plan around it.',
    path: '/service-area',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Service Area', path: '/service-area' },
    ]),
  })

  return (
    <>
      <PageHero
        eyebrow="Service area"
        title="Coverage is checked by ZIP code and by service"
        description="There is no single national coverage map here, because availability genuinely varies by trade and by provider. Pick a service, enter your ZIP code, and we will tell you what our records show."
        crumbs={[{ label: 'Service Area' }]}
      />

      <section className="section pt-10 sm:pt-12">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
            <div className="card p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-ink">Check your ZIP code</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                Choose the service you need and enter a 5-digit US ZIP code. We check service-specific
                coverage records — never a blanket yes.
              </p>
              <div className="mt-5">
                <ZipCheckForm showServiceSelect buttonLabel="Check coverage" />
              </div>
              <div className="mt-5 rounded-xl border border-line bg-soft p-4">
                <p className="flex items-start gap-2 text-[0.8125rem] leading-6 text-muted">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <span>
                    A result means the service is or is not listed in our coverage records for that ZIP code.
                    It is not a booking, a price quote, or a promise that a provider will call you.
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-soft p-6">
                <h2 className="font-display text-base font-bold text-ink">How coverage works</h2>
                <ol className="mt-4 space-y-3">
                  {[
                    'Each service has its own coverage records, maintained separately from the website design.',
                    'Coverage reflects participating providers — not every licensed provider in your area.',
                    'If our records do not confirm coverage, the checker says so and invites you to contact us.',
                    'Coverage changes as providers join or update their service areas.',
                  ].map((item, index) => (
                    <li key={item} className="flex gap-3 text-[0.8125rem] leading-6 text-muted">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-2xs font-bold text-brand-700 shadow-sm dark:text-brand-300">
                        {index + 1}
                      </span>
                      {item}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-6">
                <h2 className="font-display text-base font-bold text-ink">Not listed in your area?</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  Coverage expands as providers join. Tell us which service and ZIP code you need and we will
                  look into nearby options for you.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/contact" className="btn-primary btn-sm">
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    Contact our team
                  </Link>
                  <Link to="/services" className="btn-secondary btn-sm">
                    Browse services
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {SITE.showLaunchNotices ? (
            <LaunchNotice title="Coverage dataset status">
              <p>
                The availability checker is wired to a configurable dataset in{' '}
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">src/config/coverage.ts</code>. The
                dataset shipped with this build is a labelled example used to demonstrate the flow. Replace it
                with your contracted coverage, mark each record{' '}
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">verified: true</code> only when it
                is confirmed, and set{' '}
                <code className="rounded bg-black/5 px-1 dark:bg-white/10">EXAMPLE_COVERAGE_DATA</code> to
                false before launch.
              </p>
            </LaunchNotice>
          ) : null}
        </div>
      </section>

      <section className="section bg-soft pt-0 sm:pt-0">
        <div className="container-page pt-12 sm:pt-16">
          <SectionHeading
            eyebrow="By category"
            title="Coverage at a glance"
            description="Coverage scope differs by trade. Each row shows the current status recorded for that service."
          />
          <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
            <ul className="divide-y divide-line">
              {SERVICES.map((service) => (
                <li
                  key={service.slug}
                  className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-soft/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      <ServiceIcon name={service.icon} className="h-4 w-4" />
                    </span>
                    <div>
                      <Link
                        to={servicePath(service.slug)}
                        className="font-display text-sm font-bold text-ink transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        {service.name}
                      </Link>
                      <p className="text-xs text-muted">{coverageSummary(service.slug)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-12 sm:pl-0">
                    <button
                      type="button"
                      onClick={() => open({ serviceSlug: service.slug })}
                      className="btn-secondary btn-sm"
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                      Check ZIP
                    </button>
                    <Link
                      to={servicePath(service.slug)}
                      aria-label={`About ${service.name}`}
                      className="rounded-lg p-2 text-muted transition-colors hover:bg-soft hover:text-ink"
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <CtaBand
        headline="Find out what is available near you"
        description="Coverage takes seconds to check and does not commit you to anything."
        primaryLabel="Check my ZIP code"
        secondaryLabel="How it works"
        secondaryTo="/how-it-works"
      />
    </>
  )
}

export default ServiceArea
