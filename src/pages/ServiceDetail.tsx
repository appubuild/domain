import { Link, useParams } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  MapPin,
  MessageSquare,
  Phone,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useSeo, breadcrumbJsonLd, faqJsonLd } from '@/lib/seo'
import { SERVICE_CATEGORIES, getService, relatedServices, servicePath } from '@/config/services'
import { coverageSummary } from '@/config/coverage'
import { SITE, hasPhone, telHref } from '@/config/site'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { ZipCheckForm } from '@/components/availability/ZipCheckForm'
import { useAvailability } from '@/components/availability/AvailabilityContext'
import { ServiceIcon } from '@/components/ServiceIcon'
import { FaqAccordion } from '@/components/FaqAccordion'
import { SectionHeading } from '@/components/SectionHeading'
import { ServiceCard } from '@/components/ServiceCard'
import { CtaBand } from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import NotFound from '@/pages/NotFound'

const CONNECTION_STEPS = [
  {
    icon: MapPin,
    title: 'Check coverage',
    body: 'Enter your ZIP code and we compare it with our coverage records for this service.',
  },
  {
    icon: Users,
    title: 'Review options',
    body: 'If providers are listed for your area, we show the contact options they have authorized us to publish.',
  },
  {
    icon: Phone,
    title: 'Decide for yourself',
    body: 'Reach out directly, request a quote, or ask our team for help. There is no obligation at any step.',
  },
]

const ServiceDetail = () => {
  const { slug = '' } = useParams()
  const service = getService(slug)
  const { open } = useAvailability()
  const related = service ? relatedServices(service) : []

  useSeo({
    title: service ? service.metaTitle : 'Service not found',
    description: service
      ? service.metaDescription
      : 'The service page you requested could not be found.',
    path: `/services/${slug}`,
    image: service?.image,
    noindex: !service,
    jsonLd: service
      ? [
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/services' },
            { name: service.name, path: `/services/${service.slug}` },
          ]),
          faqJsonLd(service.faqs),
        ]
      : undefined,
  })

  if (!service) return <NotFound />

  const category = SERVICE_CATEGORIES.find((item) => item.id === service.category)

  return (
    <>
      {/* ----------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden border-b border-line bg-soft">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl"
        />
        <div className="container-page relative py-8 sm:py-10 lg:py-14">
          <Breadcrumbs
            items={[
              { label: 'Services', to: '/services' },
              { label: service.name },
            ]}
          />

          <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
            <div>
              {category ? (
                <Link
                  to={`/services?category=${category.id}`}
                  className="eyebrow hover:border-brand-300"
                >
                  <ServiceIcon name={service.icon} className="h-3.5 w-3.5" />
                  {category.name}
                </Link>
              ) : null}
              <h1 className="mt-4 max-w-2xl font-display text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-4xl lg:text-[2.6rem]">
                {service.heroHeadline}
              </h1>
              <p className="mt-4 max-w-xl text-[0.9375rem] leading-7 text-muted sm:text-base sm:leading-8">
                {service.heroSubheadline}
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => open({ serviceSlug: service.slug })}
                  className="btn-primary"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Check availability in your ZIP
                </button>
                <Link to="/contact" className="btn-secondary">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Ask a question
                </Link>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  Independent, participating providers
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  {coverageSummary(service.slug)}
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:rounded-3xl">
                <img
                  src={service.image}
                  alt={`${service.name} work in a residential home`}
                  className="h-56 w-full object-cover sm:h-72 lg:h-[21rem]"
                  width={1376}
                  height={768}
                          decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- Main content */}
      <section className="section pt-12">
        <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          <div className="min-w-0">
            {/* Intro */}
            <div id="overview" className="scroll-mt-28">
              <div className="space-y-4">
                {service.intro.map((paragraph) => (
                  <p key={paragraph.slice(0, 32)} className="text-[0.9375rem] leading-7 text-muted sm:text-base sm:leading-8">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>

            {/* Common needs */}
            <div id="common-needs" className="mt-12 scroll-mt-28">
              <SectionHeading
                as="h2"
                eyebrow="When people call"
                title={`Common ${service.name.toLowerCase()} situations`}
                description="These are the requests homeowners most often bring to this category. Every situation still needs an on-site assessment before work is quoted."
              />
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {service.commonNeeds.map((need, index) => (
                  <Reveal key={need.title} delay={(index % 2) * 60}>
                    <div className="h-full rounded-xl border border-line bg-surface p-5">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div>
                          <h3 className="font-display text-sm font-bold text-ink">{need.title}</h3>
                          <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted">{need.description}</p>
                        </div>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>

            {/* Options */}
            <div id="options" className="mt-12 scroll-mt-28">
              <SectionHeading
                as="h2"
                eyebrow="Your choices"
                title={`${service.name} options you may be offered`}
                description="Contractors use different materials, methods and equipment. Understanding the categories makes quotes easier to compare."
              />
              <ol className="mt-6 space-y-3">
                {service.options.map((option, index) => (
                  <li
                    key={option.title}
                    className="flex gap-4 rounded-xl border border-line bg-surface p-5"
                  >
                    <span className="font-display text-sm font-extrabold text-brand-600 dark:text-brand-400">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h3 className="font-display text-sm font-bold text-ink">{option.title}</h3>
                      <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted">{option.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Provider connection */}
            <div id="how-it-works" className="mt-12 scroll-mt-28">
              <SectionHeading
                as="h2"
                eyebrow="Connections"
                title="How provider connections work"
                description={`${SITE.name} is a connection platform. Here is exactly what happens when you ask us about ${service.name.toLowerCase()}.`}
              />
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {CONNECTION_STEPS.map((step) => (
                  <div key={step.title} className="rounded-xl border border-line bg-soft p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-brand-700 shadow-sm dark:text-brand-300">
                      <step.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <h3 className="mt-3 font-display text-sm font-bold text-ink">{step.title}</h3>
                    <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted">{step.body}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 rounded-xl border border-line bg-surface p-4 text-[0.8125rem] leading-6 text-muted">
                <strong className="font-semibold text-ink">Good to know: </strong>
                {service.processNote}
              </p>
            </div>

            {/* Availability checker */}
            <div id="availability" className="mt-12 scroll-mt-28">
              <div className="relative overflow-hidden rounded-2xl border border-line bg-elevated p-6 shadow-card sm:p-8">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-500/10 blur-3xl"
                />
                <div className="relative">
                  <div className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.16em] text-brand-700 dark:text-brand-300">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    Availability checker
                  </div>
                  <h2 className="mt-3 font-display text-xl font-extrabold text-ink sm:text-2xl">
                    Is {service.name.toLowerCase()} available in your area?
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                    Enter a 5-digit US ZIP code. We check our coverage records for this service — no account
                    and no obligation.
                  </p>
                  <div className="mt-5 max-w-xl">
                    <ZipCheckForm defaultService={service.slug} />
                  </div>
                  <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
                    <li className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
                      We never guess at coverage
                    </li>
                    <li className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
                      Your ZIP is used only to check availability
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* FAQ */}
            <div id="faq" className="mt-12 scroll-mt-28">
              <SectionHeading
                as="h2"
                eyebrow="Questions"
                title={`${service.name} FAQs`}
                description="Practical answers to the questions homeowners ask before they start calling contractors."
              />
              <div className="mt-6">
                <FaqAccordion items={service.faqs} defaultOpen={0} />
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="card overflow-hidden">
              <div className="border-b border-line bg-soft px-5 py-4">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">Quick check</p>
                <p className="mt-1 font-display text-sm font-bold text-ink">
                  {service.name} availability
                </p>
              </div>
              <div className="p-5">
                <p className="text-[0.8125rem] leading-6 text-muted">
                  Coverage depends on participating providers in your ZIP code.
                </p>
                <button
                  type="button"
                  onClick={() => open({ serviceSlug: service.slug })}
                  className="btn-primary btn-sm mt-4 w-full"
                >
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Check my ZIP code
                </button>
                {hasPhone() ? (
                  <a href={telHref() as string} className="btn-secondary btn-sm mt-2 w-full">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {SITE.contact.phoneDisplay}
                  </a>
                ) : (
                  <Link to="/contact" className="btn-secondary btn-sm mt-2 w-full">
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    Contact our team
                  </Link>
                )}
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">On this page</p>
                  <ul className="mt-2 space-y-1">
                    {[
                      { id: 'overview', label: 'Overview' },
                      { id: 'common-needs', label: 'Common situations' },
                      { id: 'options', label: 'Options' },
                      { id: 'how-it-works', label: 'How connections work' },
                      { id: 'availability', label: 'Availability checker' },
                      { id: 'faq', label: `${service.name} FAQs` },
                    ].map((item) => (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.8125rem] text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                        >
                          <ChevronRight className="h-3 w-3" aria-hidden="true" />
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-soft p-5">
              <p className="font-display text-sm font-bold text-ink">Related services</p>
              <ul className="mt-3 space-y-2">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link
                      to={servicePath(item.slug)}
                      className="group flex items-center gap-2.5 text-[0.8125rem] font-medium text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      <ServiceIcon name={item.icon} className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                      {item.name}
                      <ArrowRight className="ml-auto h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-5">
              <ShieldCheck className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted">
                {SITE.name} does not perform {service.name.toLowerCase()} work. Providers are independent
                businesses responsible for their own licensing, insurance and pricing.
              </p>
              <Link to="/disclaimer" className="mt-2 inline-block text-[0.8125rem] font-semibold text-brand-700 dark:text-brand-300">
                Read our disclaimer
              </Link>
            </div>
          </aside>
        </div>
      </section>

      {/* ------------------------------------------------- Related services */}
      {related.length > 0 ? (
        <section className="section bg-soft pt-0 sm:pt-0" aria-labelledby="related-services">
          <div className="container-page pt-12 sm:pt-16">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeading
                id="related-services"
                as="h2"
                eyebrow="Keep exploring"
                title="Related services homeowners often need together"
              />
              <Link
                to="/services"
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300"
              >
                All services
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((item, index) => (
                <Reveal key={item.slug} delay={index * 70} className="h-full">
                  <ServiceCard service={item} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <CtaBand
        headline={`Ready to check ${service.name.toLowerCase()} availability?`}
        description="Enter your ZIP code to see whether providers are listed for your area, or contact our team and we will help you look."
        primaryLabel="Check your area"
        serviceSlug={service.slug}
      />
    </>
  )
}

export default ServiceDetail
