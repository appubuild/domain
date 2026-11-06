import { Link } from 'react-router-dom'
import { ArrowRight, Mail, ShieldCheck } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE } from '@/config/site'
import { PageHero } from '@/components/PageHero'
import { LaunchNotice } from '@/components/LaunchNotice'

const SECTIONS = [
  { id: 'summary', label: 'Our position in short' },
  { id: 'categories', label: 'Information we handle' },
  { id: 'opt-out', label: 'How to submit a request' },
  { id: 'signals', label: 'Global Privacy Control' },
  { id: 'agents', label: 'Authorized agents' },
  { id: 'verification', label: 'How we verify requests' },
  { id: 'other-rights', label: 'Your other privacy rights' },
]

const DoNotSellOrShare = () => {
  useSeo({
    title: 'Do Not Sell or Share My Personal Information',
    description:
      'Safe Home Network does not sell personal information or share it for cross-context behavioral advertising. Here is how to submit a privacy request or opt out.',
    path: '/do-not-sell-or-share',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Do Not Sell or Share', path: '/do-not-sell-or-share' },
    ]),
  })

  return (
    <>
      <PageHero
        compact
        eyebrow="Privacy choices"
        title="Do Not Sell or Share My Personal Information"
        description="This page explains our position under California and other state privacy laws, and how to submit a request."
        crumbs={[{ label: 'Do Not Sell or Share' }]}
      />

      <section className="section pt-8 sm:pt-10">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-line bg-soft p-4">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">On this page</p>
                <ul className="mt-3 space-y-1">
                  {SECTIONS.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="block rounded-md px-1.5 py-1 text-[0.8125rem] leading-5 text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        {section.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            <div className="min-w-0">
              <p className="mb-6 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Last updated: November 6, 2026
              </p>

              <div className="rounded-2xl border border-success-600/25 bg-success-50/60 p-5 dark:border-success-500/25 dark:bg-success-500/10">
                <p className="flex items-center gap-2 font-display text-sm font-bold text-success-800 dark:text-success-200">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  We do not sell personal information
                </p>
                <p className="mt-2 text-sm leading-6 text-success-900/80 dark:text-success-100/80">
                  {SITE.name} does not sell personal information and does not share personal information for
                  cross-context behavioral advertising. There is no “sale” to opt out of. The options below let
                  you request access, correction or deletion, and record an opt-out preference for the future.
                </p>
              </div>

              <div className="prose-legal mt-8 max-w-3xl">
                <h2 id="summary">Our position in short</h2>
                <p>
                  The California Consumer Privacy Act as amended by the CPRA, and comparable laws in other
                  states, give residents the right to opt out of the “sale” or “sharing” of personal
                  information. We do not engage in either activity. We do not exchange personal information for
                  money or other valuable consideration, and we do not disclose personal information for
                  cross-context behavioral advertising.
                </p>
                <p>
                  The one exception is a disclosure you initiate yourself: if you ask us to connect you with a
                  provider, we share the details necessary for that provider to respond to you. That is a
                  service you requested, not a sale.
                </p>

                <h2 id="categories">Information we handle</h2>
                <ul>
                  <li>
                    <strong>Identifiers</strong> — name, email address, IP address.
                  </li>
                  <li>
                    <strong>Internet activity</strong> — pages viewed, interactions with the availability
                    checker, referring URL.
                  </li>
                  <li>
                    <strong>Geolocation data (coarse)</strong> — a five-digit ZIP code you enter, and
                    city-level location inferred from IP address.
                  </li>
                  <li>
                    <strong>Communications</strong> — the content of messages you send through the contact
                    form or by email.
                  </li>
                  <li>
                    <strong>Inferences</strong> — which service categories interest you based on the pages you
                    visit and the checks you run, used to answer your request and improve the site.
                  </li>
                </ul>

                <h2 id="opt-out">How to submit a request</h2>
                <p>
                  To request access to, correction of, or deletion of your personal information, or to record
                  an opt-out preference:
                </p>
                <ul>
                  <li>
                    Email <a href={`mailto:${SITE.contact.email}`}>{SITE.contact.email}</a> with the subject
                    line “Do Not Sell or Share Request” or “Privacy Request,” and tell us what you would like us
                    to do.
                  </li>
                  <li>
                    Or use our <Link to="/contact">contact form</Link> and select “Privacy or data request” as
                    the subject.
                  </li>
                </ul>
                <p>
                  We will confirm receipt and respond within the timeframe required by applicable law
                  (generally 45 days for California requests, with a possible extension where permitted).
                </p>

                <h2 id="signals">Global Privacy Control</h2>
                <p>
                  We honor opt-out preference signals, including the Global Privacy Control (GPC), where
                  required by law and where our consent tooling supports it. Because we do not sell or share
                  personal information, a GPC signal does not change what we do with your data — but we record
                  the preference and treat it as a request to limit any future sharing.
                </p>

                <h2 id="agents">Authorized agents</h2>
                <p>
                  You may submit a request through an authorized agent where the law permits. We may ask for
                  written permission signed by you and may contact you directly to verify the request, unless
                  the agent holds a valid power of attorney.
                </p>

                <h2 id="verification">How we verify requests</h2>
                <p>
                  We verify access and deletion requests by matching the information you provide against our
                  records — for example, the email address used to contact us. If we cannot verify a request,
                  we will explain why and tell you what additional information is needed. We will never ask for
                  a Social Security number or financial account details to process a privacy request.
                </p>

                <h2 id="other-rights">Your other privacy rights</h2>
                <p>
                  You also have the right to be free from discrimination for exercising your privacy rights.
                  We do not offer financial incentives in exchange for personal information. For a full
                  description of our practices, see our <Link to="/privacy-policy">Privacy Policy</Link>.
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-soft p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-sm font-bold text-ink">Ready to submit a request?</p>
                  <p className="mt-1 text-sm text-muted">Email us and we will confirm receipt within a few days.</p>
                </div>
                <a href={`mailto:${SITE.contact.email}?subject=Privacy%20Request`} className="btn-primary btn-sm shrink-0">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  Email a privacy request
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>

              {SITE.showLaunchNotices ? (
                <LaunchNotice title="Confirm before launch">
                  <p>
                    If you later enable advertising pixels, remarketing tags or any tool that discloses
                    personal information for cross-context behavioral advertising, this page and your consent
                    interface must be updated before those tools go live.
                  </p>
                </LaunchNotice>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

export default DoNotSellOrShare
