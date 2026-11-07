import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Eye,
  HeartHandshake,
  Phone,
  Scale,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { SERVICES } from '@/config/services'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { CtaBand } from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import { useCallSheet } from '@/components/calls/CallContext'

const WHAT_WE_DO = [
  {
    icon: Sparkles,
    title: 'Make service categories understandable',
    body:
      'Each category page explains what the work typically involves, what the common options are, and which questions are worth asking before you commit to anything.',
  },
  {
    icon: Phone,
    title: 'Put the right line one tap away',
    body:
      'Every service shows the phone line assigned to that trade, with an alternate beside it, so you can call directly from the page.',
  },
  {
    icon: Users,
    title: 'Connect you with independent providers',
    body:
      'Calls are answered by independent participating providers. When a category has no published line yet, we say so plainly instead of guessing.',
  },
]

const COMMITMENTS = [
  {
    icon: Eye,
    title: 'Transparency first',
    body:
      'We label what we know and what we do not. We do not display a phone number we cannot stand behind, and we do not describe a provider as available when our records do not confirm it.',
  },
  {
    icon: ShieldCheck,
    title: 'Privacy by default',
    body:
      'We do not sell personal information. This website does not ask for your ZIP code or track your location — there is nothing to build an advertising profile from. See our Privacy Policy for the detail.',
  },
  {
    icon: Scale,
    title: 'No inflated promises',
    body:
      'We do not publish invented statistics, fabricated reviews or guaranteed outcomes. If a claim cannot be substantiated, it does not belong on this site.',
  },
  {
    icon: HeartHandshake,
    title: 'Respect for your decision',
    body:
      'You are never obligated to hire anyone you meet through this platform. Compare, ask questions, and walk away if something does not feel right.',
  },
]

const About = () => {
  const { open } = useCallSheet()

  useSeo({
    title: 'About Safe Home Network',
    description:
      'Learn how Safe Home Network helps homeowners explore home service categories and call the line assigned to the trade they need, connecting them with independent local providers.',
    path: '/about',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'About Us', path: '/about' },
    ]),
  })

  return (
    <>
      <PageHero
        eyebrow="About us"
        title="Helping Homeowners Navigate Home Service Options"
        description="Safe Home Network exists to make the first step of a home project less confusing: understand the work, check what is available near you, and decide who to talk to."
        crumbs={[{ label: 'About Us' }]}
        image={{
          src: '/images/hero-home.jpg',
          alt: 'Residential home exterior representing the homeowners Safe Home Network serves',
        }}
      />

      <section className="section">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="Who we are"
                title="A connection platform, not a contractor"
                description="We are not a roofing company, a plumbing company or a remodeling firm. We are a directory and referral service that helps homeowners find independent businesses that perform that work."
              />
              <div className="mt-6 space-y-4 text-[0.9375rem] leading-7 text-muted">
                <p>
                  {SITE.name} was built around a simple observation: finding a reliable home service provider
                  is less about finding a list of names and more about understanding what you are asking for.
                  Homeowners who know the difference between a repair and a replacement, or between a
                  maintenance visit and an emergency call, make better decisions and ask better questions.
                </p>
                <p>
                  So we write the explanatory part ourselves — the needs, the options, the trade-offs and the
                  questions to ask — and we keep the phone side deliberately simple: one published line per
                  trade, stored centrally, with an alternate number when the first is busy.
                </p>
                <p>
                  Providers who participate are independent businesses. They set their own pricing, schedule
                  their own work, hold their own licenses and insurance, and answer for their own quality.
                  When we connect a homeowner with a provider, we may receive compensation — which is how the
                  platform is funded.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-6">
                <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-muted">
                  At a glance
                </h2>
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    ['Business model', 'Home services directory and referral platform'],
                    ['Service categories', `${SERVICES.length} categories across repairs, systems and remodels`],
                    ['Cost to homeowners', 'Free to browse and call a service line'],
                    ['Work performed by', 'Independent participating providers'],
                    ['Phone lines', 'One primary line per service, plus an alternate'],
                  ].map(([term, value]) => (
                    <div key={term} className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                      <dt className="text-muted">{term}</dt>
                      <dd className="text-right font-semibold text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" onClick={() => open()} className="btn-primary btn-sm mt-5 w-full">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  Call Now
                </button>
              </div>

              <div className="rounded-2xl border border-line bg-soft p-5">
                <p className="flex items-start gap-2 text-[0.8125rem] leading-6 text-muted">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <span>
                    {SITE.modelStatement} Providers are independent businesses and are solely responsible for
                    the work they perform, their licensing, insurance and pricing.
                  </span>
                </p>
              </div>
            </div>
          </div>

        </div>
      </section>

      <section className="section bg-soft">
        <div className="container-page">
          <SectionHeading
            align="center"
            eyebrow="What we do"
            title="Three things we focus on"
            description="We keep the scope narrow on purpose. Everything else belongs to the provider you choose."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {WHAT_WE_DO.map((item, index) => (
              <Reveal key={item.title} delay={index * 80} className="h-full">
                <div className="card h-full p-6">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-white">
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-display text-base font-bold text-ink">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-muted">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container-page">
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <SectionHeading
              eyebrow="Our commitments"
              title="How we try to earn your trust"
              description="Trust in home services is mostly about honesty in the small details: what a quote includes, who is responsible, and what happens if something goes wrong."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {COMMITMENTS.map((item, index) => (
                <Reveal key={item.title} delay={index * 60} className="h-full">
                  <div className="h-full rounded-xl border border-line bg-surface p-5">
                    <item.icon className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                    <h3 className="mt-3 font-display text-sm font-bold text-ink">{item.title}</h3>
                    <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl border border-line bg-soft p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">Questions about how we operate?</h2>
              <p className="mt-1 text-sm text-muted">
                Ask us anything about our model, coverage, or how provider listings work.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/contact" className="btn-primary btn-sm">
                Contact us
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/how-it-works" className="btn-secondary btn-sm">
                How it works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        headline="Start with the service you need"
        description="Pick the trade and call the line assigned to it — or browse every category first."
        primaryLabel="Call Now"
        secondaryLabel="Browse services"
        secondaryTo="/services"
      />
    </>
  )
}

export default About
