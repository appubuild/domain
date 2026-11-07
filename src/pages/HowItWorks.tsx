import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Compass,
  MessageSquare,
  Phone,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react'
import { useSeo, breadcrumbJsonLd, faqJsonLd } from '@/lib/seo'
import { HOW_IT_WORKS_FAQS } from '@/config/faqs'
import { SITE, hasPhone, telHref } from '@/config/site'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { FaqAccordion } from '@/components/FaqAccordion'
import { CtaBand } from '@/components/CtaBand'
import { useCallSheet } from '@/components/calls/CallContext'
import { Reveal } from '@/components/Reveal'

const STEPS = [
  {
    number: '01',
    icon: Compass,
    title: 'Choose your service',
    body: 'Pick the category that matches your project. Each page explains what the work usually involves and which options contractors commonly offer, so you can describe what you need accurately.',
    detail: [
      '15 categories covering repairs, systems, restoration and remodels',
      'Plain-language explanations, not sales copy',
      'FAQs written for the questions homeowners actually ask',
    ],
    image: '/images/service-plumbing.jpg',
    alt: 'Plumber tightening a fitting beneath a kitchen sink',
  },
  {
    number: '02',
    icon: Phone,
    title: 'Tap Call Now',
    body: 'The service card and the service page both carry a Call Now button. It opens the primary and alternate numbers assigned to that trade — no ZIP code, no forms, no waiting.',
    detail: [
      'One number per trade, assigned in a central directory',
      'Primary line first, alternate line beside it',
      'Every button is a plain tel: link that starts a normal call',
    ],
    image: '/images/service-roofing.jpg',
    alt: 'Roofing crew installing architectural shingles on a home',
  },
  {
    number: '03',
    icon: Users,
    title: 'Speak with a participating provider',
    body: 'Calls are answered by independent providers who perform the work and set their own pricing and scheduling. Ask about scope, timing and local availability before you commit.',
    detail: [
      'Providers remain responsible for licensing, insurance and workmanship',
      'No invented phone numbers and no inflated availability claims',
      'Contact our team any time if a category has no published line yet',
    ],
    image: '/images/service-hvac.jpg',
    alt: 'HVAC technician servicing residential heating equipment',
  },
]

const OUTCOMES = [
  {
    icon: CheckCircle2,
    tone: 'success',
    title: 'A line answers',
    body:
      'A participating provider picks up and can tell you whether they cover your address, when they can come out, and what a visit costs.',
  },
  {
    icon: XCircle,
    tone: 'amber',
    title: 'Try the alternate line',
    body:
      'If the primary line is busy or outside service hours, the alternate number for the same trade is shown right next to it.',
  },
  {
    icon: CircleHelp,
    tone: 'brand',
    title: 'No line published yet',
    body:
      'A few categories do not have a published line. Those pages say so and offer our contact form rather than a number we cannot stand behind.',
  },
]

const HowItWorks = () => {
  const { open } = useCallSheet()

  useSeo({
    title: 'How It Works',
    description:
      'See how Safe Home Network works: choose a service, tap the Call Now button assigned to that trade, and speak directly with an independent provider.',
    path: '/how-it-works',
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'How It Works', path: '/how-it-works' },
      ]),
      faqJsonLd(HOW_IT_WORKS_FAQS),
    ],
  })

  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="Three steps, no pressure, no guesswork"
        description="Safe Home Network is designed to answer two questions quickly: what does this project involve, and is anyone listed near me? Here is the whole process."
        crumbs={[{ label: 'How It Works' }]}
      >
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => open()} className="btn-primary">
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call Now
          </button>
          <Link to="/services" className="btn-secondary">
            Browse services
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </PageHero>

      <section className="section">
        <div className="container-page space-y-14 lg:space-y-20">
          {STEPS.map((step, index) => (
            <div key={step.number} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <Reveal className={index % 2 === 1 ? 'lg:order-2' : ''}>
                <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card lg:rounded-3xl">
                  <img
                    src={step.image}
                    alt={step.alt}
                    className="h-56 w-full object-cover sm:h-72 lg:h-[24rem]"
                    loading="lazy"
                    decoding="async"
                    width={1376}
                    height={768}
                  />
                  <span className="absolute left-4 top-4 rounded-full bg-navy-950/80 px-3 py-1 text-2xs font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
                    Step {step.number}
                  </span>
                </div>
              </Reveal>

              <Reveal delay={80} className={index % 2 === 1 ? 'lg:order-1' : ''}>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                    <step.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="font-display text-4xl font-extrabold text-line dark:text-navy-700">
                    {step.number}
                  </span>
                </div>
                <h2 className="mt-4 font-display text-2xl font-extrabold text-ink sm:text-3xl">{step.title}</h2>
                <p className="mt-3 text-[0.9375rem] leading-7 text-muted">{step.body}</p>
                <ul className="mt-5 space-y-2.5">
                  {step.detail.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm leading-6 text-muted">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600 dark:text-success-500" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
                {step.number === '03' ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={() => open()} className="btn-primary btn-sm">
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      Call Now
                    </button>
                    <Link to="/contact" className="btn-secondary btn-sm">
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                      Talk to our team
                    </Link>
                  </div>
                ) : null}
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      <section className="section bg-soft">
        <div className="container-page">
          <SectionHeading
            align="center"
            eyebrow="When you call"
            title="Three things that can happen on the call"
            description="Straight answers, including when the news is not what you hoped for."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {OUTCOMES.map((outcome, index) => {
              const tone = {
                success: {
                  wrap: 'border-success-600/25 dark:border-success-500/30',
                  icon: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300',
                },
                amber: {
                  wrap: 'border-amber-500/30 dark:border-amber-400/30',
                  icon: 'bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
                },
                brand: {
                  wrap: 'border-brand-500/25 dark:border-brand-400/30',
                  icon: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                },
              }[outcome.tone] as { wrap: string; icon: string }

              return (
                <Reveal key={outcome.title} delay={index * 70} className="h-full">
                  <div className={`card h-full border p-6 ${tone.wrap}`}>
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full ${tone.icon}`}>
                      <outcome.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 font-display text-base font-bold text-ink">{outcome.title}</h3>
                    <p className="mt-2 text-sm leading-7 text-muted">{outcome.body}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-muted">
            Availability, pricing and response times are set by each independent provider. A call is not a
            booking, a quote, or a guarantee of service.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container-page grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="After the check"
              title="What happens next is up to you"
              description="There is no auto-dial, no pressure and no obligation. Choose the path that fits your project."
            />
            <div className="mt-8 space-y-3">
              {[
                {
                  icon: Phone,
                  title: 'Call a published provider directly',
                  body: 'If a provider has authorized their number to be listed, you can call them without going through us.',
                },
                {
                  icon: MessageSquare,
                  title: 'Ask our team for help',
                  body: 'Tell us what you need and we will point you to the right trade and line.',
                },
                {
                  icon: ClipboardCheck,
                  title: 'Compare before you commit',
                  body: 'Request more than one quote, ask for written scope and warranty details, and confirm licensing and insurance.',
                },
              ].map((item) => (
                <div key={item.title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-soft text-brand-700 dark:text-brand-300">
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-ink">{item.title}</h3>
                    <p className="mt-1 text-[0.8125rem] leading-6 text-muted">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-elevated p-6 shadow-card">
              <h3 className="font-display text-lg font-bold text-ink">Ready to call a service line?</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                Pick the trade you need and the primary and alternate numbers appear. No ZIP code, no forms.
              </p>
              <button type="button" onClick={() => open()} className="btn-primary btn-sm mt-4 w-full">
                <Phone className="h-4 w-4" aria-hidden="true" />
                Call Now
              </button>
              {hasPhone() ? (
                <a href={telHref() as string} className="btn-secondary btn-sm mt-3 w-full">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {SITE.contact.phoneDisplay}
                </a>
              ) : (
                <Link to="/contact" className="btn-secondary btn-sm mt-3 w-full">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Message our team
                </Link>
              )}
            </div>
            <div className="rounded-2xl border border-line bg-soft p-5">
              <p className="flex items-start gap-2 text-[0.8125rem] leading-6 text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                <span>
                  {SITE.modelStatement} Providers are responsible for their own licensing, insurance, pricing
                  and workmanship.
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section bg-soft pt-0 sm:pt-0" aria-labelledby="how-faq">
        <div className="container-page pt-14">
          <SectionHeading id="how-faq" align="center" eyebrow="FAQ" title="Questions about the process" />
          <div className="mx-auto mt-8 max-w-3xl">
            <FaqAccordion items={HOW_IT_WORKS_FAQS} defaultOpen={0} />
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}

export default HowItWorks
