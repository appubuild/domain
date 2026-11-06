import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Compass,
  Layers,
  MapPin,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useSeo, faqJsonLd, organizationJsonLd, websiteJsonLd } from '@/lib/seo'
import { HOME_FAQS } from '@/config/faqs'
import { SERVICES, featuredServices, servicePath } from '@/config/services'
import { SITE } from '@/config/site'
import { useAvailability } from '@/components/availability/AvailabilityContext'
import { ZipCheckForm } from '@/components/availability/ZipCheckForm'
import { ServiceCard } from '@/components/ServiceCard'
import { SectionHeading } from '@/components/SectionHeading'
import { FaqAccordion } from '@/components/FaqAccordion'
import { CtaBand } from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import { ServiceIcon } from '@/components/ServiceIcon'

const TRUST_ITEMS = [
  {
    icon: Compass,
    title: 'Convenient service discovery',
    description: 'Browse every major home service category in one place instead of juggling search results.',
  },
  {
    icon: MapPin,
    title: 'Local availability checking',
    description: 'Enter a ZIP code to see whether providers are listed for that service in your area.',
  },
  {
    icon: Layers,
    title: 'Multiple service categories',
    description: `From roofing to locksmith work — ${SERVICES.length} categories covering repairs, systems and remodels.`,
  },
  {
    icon: MessageSquare,
    title: 'Easy provider connections',
    description: 'Review published provider options or ask our team to help you find what is available nearby.',
  },
]

const BENEFITS = [
  {
    icon: Search,
    title: 'Clear information, not pressure',
    description:
      'Each service page explains what the work usually involves, what options exist and which questions to ask — before anyone calls you.',
  },
  {
    icon: Layers,
    title: 'One place for every trade',
    description:
      'Roofing, plumbing, HVAC, restoration, remodeling, electrical, windows, doors, concrete and locksmith services share one consistent directory.',
  },
  {
    icon: BadgeCheck,
    title: 'Transparency about coverage',
    description:
      'If our coverage records do not confirm a service in your ZIP code, we say so plainly instead of promising a callback that will not come.',
  },
  {
    icon: Clock,
    title: 'A simple connection process',
    description:
      'Check availability, review the options listed for your area, and decide for yourself whether to reach out. No obligation at any step.',
  },
]

const STEPS = [
  {
    number: '01',
    icon: Compass,
    title: 'Choose your service',
    description:
      'Start with the category that matches your project — a repair, a system that needs attention, or a full remodel.',
    action: { label: 'Browse services', to: '/services' },
  },
  {
    number: '02',
    icon: MapPin,
    title: 'Check your ZIP code',
    description:
      'Enter your 5-digit ZIP code and we compare it against our coverage records for that specific service.',
  },
  {
    number: '03',
    icon: Users,
    title: 'Explore available providers',
    description:
      'Review participating provider options listed for your area, or ask our team to help you find the right fit.',
  },
]

const Home = () => {
  const { open } = useAvailability()
  const popular = featuredServices()

  useSeo({
    title: SITE.seo.defaultTitle,
    description: SITE.seo.defaultDescription,
    path: '/',
    jsonLd: [organizationJsonLd(), websiteJsonLd(), faqJsonLd(HOME_FAQS)],
  })

  return (
    <>
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative isolate overflow-hidden bg-navy-950">
        <img
          src="/images/hero-home.jpg"
          alt="Modern American single-family home with a newly installed roof and landscaped front yard"
          className="absolute inset-0 h-full w-full object-cover object-center"
          decoding="async"
          width={1376}
          height={768}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/92 to-navy-950/45"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/20 to-transparent"
        />

        <div className="container-page relative">
          <div className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:py-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-white/85 backdrop-blur-sm">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Home services directory · United States
              </p>

              <h1 className="mt-5 max-w-2xl font-display text-[2.125rem] font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
                Your Home Deserves the <span className="text-amber-400">Right Help.</span>
              </h1>

              <p className="mt-5 max-w-xl text-[0.9375rem] leading-7 text-white/75 sm:text-lg sm:leading-8">
                From everyday home repairs to major improvement projects, explore home service options and
                find available providers in your area.
              </p>

              <div className="mt-7 max-w-xl">
                <ZipCheckForm
                  variant="onDark"
                  showServiceSelect
                  buttonLabel="Check Availability"
                  helperText="Free to check. No account, no obligation."
                />
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={() => open()} className="btn-primary">
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Find Home Services
                </button>
                <Link
                  to="/services"
                  className="btn border border-white/25 bg-white/5 text-white backdrop-blur-sm transition-colors hover:bg-white/10"
                >
                  Explore Services
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/75">
                {[`${SERVICES.length} service categories`, 'ZIP code availability checking', 'No obligation'].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Quick-pick panel — hidden on small screens to keep the hero focused */}
            <div className="hidden lg:block">
              <div className="rounded-3xl border border-white/15 bg-white/10 p-6 shadow-float backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-white">
                    Popular categories
                  </h2>
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-2xs font-semibold text-white/80">
                    {SERVICES.length}
                  </span>
                </div>
                <ul className="mt-4 space-y-1.5">
                  {popular.slice(0, 6).map((service) => (
                    <li key={service.slug}>
                      <Link
                        to={servicePath(service.slug)}
                        className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-amber-300">
                          <ServiceIcon name={service.icon} className="h-4 w-4" />
                        </span>
                        <span className="flex-1">{service.name}</span>
                        <ArrowRight className="h-4 w-4 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/services"
                  className="mt-4 flex items-center justify-center gap-1.5 rounded-xl border border-white/20 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white"
                >
                  View all services
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- Trust strip */}
      <section className="border-b border-line bg-surface">
        <div className="container-page py-10 sm:py-12">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item, index) => (
              <Reveal key={item.title} delay={index * 70} className="flex gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="font-display text-sm font-bold text-ink">{item.title}</h2>
                  <p className="mt-1 text-[0.8125rem] leading-6 text-muted">{item.description}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ Popular services */}
      <section className="section" aria-labelledby="popular-services">
        <div className="container-page">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <SectionHeading
              id="popular-services"
              eyebrow="Service directory"
              title="Popular services homeowners ask about"
              description="Explore the categories we cover, understand what the work usually involves, and check availability in your ZIP code."
            />
            <Link
              to="/services"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
            >
              View all {SERVICES.length} services
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {popular.map((service, index) => (
              <Reveal key={service.slug} delay={(index % 3) * 80} className="h-full">
                <ServiceCard service={service} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- How it works */}
      <section className="section bg-soft" aria-labelledby="how-it-works">
        <div className="container-page">
          <SectionHeading
            id="how-it-works"
            align="center"
            eyebrow="How it works"
            title="Three steps to the right local provider"
            description="No forms to chase and no obligation. Start with the service you need and a ZIP code."
          />

          <div className="relative mt-12">
            <div
              aria-hidden="true"
              className="absolute left-0 right-0 top-11 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent lg:block"
            />
            <div className="grid gap-5 lg:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal key={step.number} delay={index * 90} className="h-full">
                  <div className="card relative h-full p-6 sm:p-7">
                    <div className="flex items-center justify-between">
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-white shadow-sm">
                        <step.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="font-display text-3xl font-extrabold text-line dark:text-navy-700">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="mt-5 font-display text-lg font-bold text-ink">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted">{step.description}</p>
                    {step.action ? (
                      <Link
                        to={step.action.to}
                        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300"
                      >
                        {step.action.label}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button type="button" onClick={() => open()} className="btn-primary">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Check availability in your ZIP
            </button>
            <Link to="/how-it-works" className="btn-secondary">
              Read the full process
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-muted">
            Actual service availability depends on participating providers and their coverage areas. A ZIP
            code result reflects our coverage records — it is not a booking or a guarantee of service.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------- Why choose us */}
      <section className="section" aria-labelledby="why-choose">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16">
            <div>
              <SectionHeading
                id="why-choose"
                eyebrow="Why Safe Home Network"
                title="A clearer starting point for home projects"
                description="Most homeowners do not need another list of ads. They need to understand the work, know whether anyone is listed nearby, and decide who to talk to."
              />

              <div className="mt-8 space-y-6">
                {BENEFITS.map((benefit, index) => (
                  <Reveal key={benefit.title} delay={index * 70} className="flex gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-brand-700 shadow-sm dark:text-brand-300">
                      <benefit.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-display text-base font-bold text-ink">{benefit.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted">{benefit.description}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>

            <Reveal className="lg:sticky lg:top-24">
              <div className="card overflow-hidden">
                <div className="relative">
                  <img
                    src="/images/service-kitchen-remodeling.jpg"
                    alt="Finished kitchen remodel with an open layout and natural light"
                    className="h-48 w-full object-cover sm:h-60"
                    loading="lazy"
                    decoding="async"
                    width={1376}
                    height={768}
                  />
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-gradient-to-t from-navy-950/80 via-navy-950/20 to-transparent"
                  />
                  <p className="absolute bottom-4 left-5 right-5 font-display text-sm font-bold text-white">
                    Real projects start with clear expectations.
                  </p>
                </div>
                <div className="p-6">
                  <h3 className="flex items-center gap-2 font-display text-base font-bold text-ink">
                    <ShieldCheck className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                    What we do — and what we do not
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm leading-6">
                    {[
                      {
                        ok: true,
                        text: 'We help you explore categories, coverage and provider options.',
                      },
                      { ok: true, text: 'We explain the work and the questions worth asking.' },
                      { ok: false, text: 'We do not perform repairs, dispatch crews or set pricing.' },
                      { ok: false, text: 'We do not guarantee availability, quality or outcomes.' },
                      { ok: false, text: 'We do not sell your personal information.' },
                    ].map((item) => (
                      <li key={item.text} className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold ${
                            item.ok
                              ? 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300'
                              : 'bg-soft text-muted'
                          }`}
                          aria-hidden="true"
                        >
                          {item.ok ? '✓' : '—'}
                        </span>
                        <span className={item.ok ? 'text-ink' : 'text-muted'}>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/about" className="btn-secondary btn-sm mt-6 w-full">
                    Learn about our platform
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ FAQ */}
      <section className="section bg-soft" aria-labelledby="faq">
        <div className="container-page">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <SectionHeading
                id="faq"
                eyebrow="Questions, answered"
                title="Frequently asked questions"
                description="Straight answers about how the platform works, what we can confirm and what we cannot."
              />
              <div className="card mt-6 p-5">
                <p className="flex items-center gap-2 font-display text-sm font-bold text-ink">
                  <MessageSquare className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  Still have a question?
                </p>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  Our team replies to messages within one business day.
                </p>
                <Link to="/contact" className="btn-primary btn-sm mt-4 w-full">
                  Contact us
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <FaqAccordion items={HOME_FAQS} defaultOpen={0} />
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}

export default Home
