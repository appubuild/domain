import { Link } from 'react-router-dom'
import { Clock, Mail, MapPin, MessageSquare, Phone, ShieldCheck } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SITE, hasPhone, telHref } from '@/config/site'
import { PageHero } from '@/components/PageHero'
import { ContactForm } from '@/components/ContactForm'
import { LaunchNotice } from '@/components/LaunchNotice'
import { useAvailability } from '@/components/availability/AvailabilityContext'

const Contact = () => {
  const { open } = useAvailability()

  useSeo({
    title: 'Contact Us',
    description:
      'Contact Safe Home Network with questions about home service categories, ZIP code availability, or provider listings. We reply within one business day.',
    path: '/contact',
    jsonLd: breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Contact', path: '/contact' },
    ]),
  })

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to our team about your project"
        description="Whether you have a question about coverage, a service category, or a provider listing, we are happy to help. Send a message and we will reply within one business day."
        crumbs={[{ label: 'Contact' }]}
      />

      <section className="section pt-10 sm:pt-12">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:gap-12">
            <div>
              <ContactForm />
              {SITE.showLaunchNotices ? (
                <LaunchNotice title="Form configuration required before launch">
                  <p>
                    Client-side validation, error states and the honest "not configured" response are in place.
                    To start delivering messages, create a form endpoint and set{' '}
                    <code className="rounded bg-black/5 px-1 dark:bg-white/10">VITE_CONTACT_ENDPOINT</code> in
                    your environment, then rebuild. Add your reCAPTCHA or hCaptcha site key to{' '}
                    <code className="rounded bg-black/5 px-1 dark:bg-white/10">
                      VITE_SPAM_PROTECTION_SITE_KEY
                    </code>{' '}
                    for additional spam protection.
                  </p>
                </LaunchNotice>
              ) : null}
            </div>

            <aside className="space-y-4">
              <div className="card p-6">
                <h2 className="font-display text-base font-bold text-ink">Contact details</h2>
                <ul className="mt-4 space-y-4">
                  <li className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      <Mail className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">Email</p>
                      <a
                        href={`mailto:${SITE.contact.email}`}
                        className="mt-0.5 block break-all text-sm font-semibold text-ink hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        {SITE.contact.email}
                      </a>
                      <p className="mt-1 text-xs text-muted">{SITE.contact.responseTime}</p>
                    </div>
                  </li>

                  {hasPhone() ? (
                    <li className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                        <Phone className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">Phone</p>
                        <a
                          href={telHref() as string}
                          className="mt-0.5 block text-sm font-semibold text-ink hover:text-brand-700 dark:hover:text-brand-300"
                        >
                          {SITE.contact.phoneDisplay}
                        </a>
                      </div>
                    </li>
                  ) : null}

                  <li className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">Support hours</p>
                      <p className="mt-0.5 text-sm font-semibold text-ink">{SITE.contact.supportHours}</p>
                    </div>
                  </li>

                  {SITE.contact.addressLines.length > 0 ? (
                    <li className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-muted">Address</p>
                        <p className="mt-0.5 text-sm font-semibold text-ink">
                          {SITE.contact.addressLines.join(', ')}
                        </p>
                      </div>
                    </li>
                  ) : null}
                </ul>
              </div>

              <div className="card p-6">
                <h2 className="font-display text-base font-bold text-ink">Looking for a service?</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted">
                  Checking availability is faster than emailing. Choose a service and enter your ZIP code.
                </p>
                <button type="button" onClick={() => open()} className="btn-primary btn-sm mt-4 w-full">
                  <MapPin className="h-4 w-4" aria-hidden="true" />
                  Check availability
                </button>
                <Link to="/services" className="btn-secondary btn-sm mt-2 w-full">
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Browse services
                </Link>
              </div>

              <div className="rounded-2xl border border-line bg-soft p-5">
                <p className="flex items-start gap-2 text-[0.8125rem] leading-6 text-muted">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                  <span>
                    {SITE.name} is a connection platform, not a contractor. We cannot dispatch emergency crews.
                    For an active leak, gas smell or safety hazard, contact a local provider or emergency
                    service directly.
                  </span>
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

export default Contact
