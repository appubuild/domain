import { Link } from 'react-router-dom'
import { ArrowRight, Phone, ShieldCheck, MapPinned } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SERVICES, servicePath } from '@/config/services'
import { SITE } from '@/config/site'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { ServiceIcon } from '@/components/ServiceIcon'
import { CtaBand } from '@/components/CtaBand'
import { ServiceCallDirectory } from '@/components/calls/ServiceCallDirectory'
import { useCallSheet } from '@/components/calls/CallContext'
import { hasCallDirectory } from '@/lib/phoneDirectory'

const ServiceArea = () => {
  const { open } = useCallSheet()

  useSeo({
    title: 'Service Area & Call Lines',
    description:
      'Safe Home Network connects homeowners with independent home service providers across the United States. Choose a trade and call the service line assigned to it — no ZIP code needed.',
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
        title="One directory, service lines across the United States"
        description="We do not ask for a ZIP code. Pick the trade you need and call the line assigned to it. The provider you speak with confirms what is available in your area."
        crumbs={[{ label: 'Service Area' }]}
      >
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => open()} className="btn-primary">
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call Now
          </button>
          <Link to="/services" className="btn-secondary">
            Browse all {SERVICES.length} services
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </PageHero>

      <section className="section pt-10 sm:pt-12">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
            <div className="card p-6 sm:p-8">
              <h2 className="font-display text-xl font-bold text-ink">How the call lines work</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                Each trade has its own service line. Choose the category that matches your project and the
                primary and alternate numbers appear — both are ordinary phone numbers you can tap to dial.
              </p>
              <ol className="mt-5 space-y-3">
                {[
                  'Pick a service category — roofing, plumbing, HVAC, electrical and so on.',
                  'Tap “Call Now” for the primary line, or “Call Alternate” if the first is busy.',
                  'The provider you reach confirms scheduling, pricing and availability in your area.',
                  'If a category has no published line yet, we say so and you can contact our team instead.',
                ].map((item, index) => (
                  <li key={item} className="flex gap-3 text-[0.8125rem] leading-6 text-muted">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-soft text-2xs font-bold text-brand-700 dark:text-brand-300">
                      {index + 1}
                    </span>
                    {item}
                  </li>
                ))}
              </ol>
              <div className="mt-5 rounded-xl border border-line bg-soft p-4">
                <p className="flex items-start gap-2 text-[0.8125rem] leading-6 text-muted">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
                    aria-hidden="true"
                  />
                  <span>
                    {SITE.name} is a connection platform. We do not perform the work, dispatch crews, set
                    pricing or guarantee that a provider covers every address.
                  </span>
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-soft p-6">
                <h2 className="font-display text-base font-bold text-ink">Why we removed the ZIP check</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  Coverage data we could not verify was more confusing than helpful. Rather than ask for a ZIP
                  code and answer with a guess, the site now does the simple thing: it shows you the line
                  assigned to the service you selected. Local availability is confirmed by the provider on the
                  call.
                </p>
              </div>

              <div className="rounded-2xl border border-line bg-surface p-6">
                <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink">
                  <MapPinned className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  Nationwide service lines
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  The published numbers are national toll-free lines, so they work from any US phone. Which
                  provider answers, and how quickly they can reach you, depends on your location.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/contact" className="btn-secondary btn-sm">
                    Contact our team
                  </Link>
                  <Link to="/how-it-works" className="btn-secondary btn-sm">
                    How it works
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section bg-soft pt-0 sm:pt-0">
        <div className="container-page pt-12 sm:pt-16">
          <SectionHeading
            eyebrow="By category"
            title="Call line availability at a glance"
            description="Every website service category with the call action that applies to it right now."
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
                      <p className="text-xs text-muted">
                        {hasCallDirectory(service.slug)
                          ? 'Primary & alternate call lines published'
                          : 'No published line yet — contact our team'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-12 sm:pl-0">
                    {hasCallDirectory(service.slug) ? (
                      <button
                        type="button"
                        onClick={() => open({ serviceSlug: service.slug })}
                        className="btn-primary btn-sm"
                      >
                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        Call Now
                      </button>
                    ) : (
                      <Link to="/contact" className="btn-secondary btn-sm">
                        Ask about this
                      </Link>
                    )}
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

      <ServiceCallDirectory
        eyebrow="Pick a service"
        title="Select a service and call its line"
        description="Ten call categories, each with a primary and an alternate number. No ZIP code, no account."
      />

      <CtaBand
        headline="Need help choosing the right trade?"
        description="Tell us what is going on and our team will point you toward the right service category and line."
        primaryLabel="Call Now"
        secondaryLabel="Contact our team"
        secondaryTo="/contact"
      />
    </>
  )
}

export default ServiceArea
