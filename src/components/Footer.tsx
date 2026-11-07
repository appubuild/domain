import { Link } from 'react-router-dom'
import { ArrowUpRight, Clock, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react'
import {
  FOOTER_COMPANY_LINKS,
  FOOTER_LEGAL_LINKS,
  SITE,
  hasPhone,
  telHref,
} from '@/config/site'
import { SERVICES, SERVICE_CATEGORIES, servicePath } from '@/config/services'
import { Logo } from '@/components/Logo'
import { useCallSheet } from '@/components/calls/CallContext'

const footerLink =
  'text-sm text-white/75 transition-colors hover:text-white focus-visible:text-white'

export const Footer = () => {
  const { open } = useCallSheet()
  const year = new Date().getFullYear()
  const socialEntries = Object.entries(SITE.social).filter(([, url]) => Boolean(url))

  return (
    <footer className="mt-auto bg-navy-950 text-white">
      <div className="container-page py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1.1fr] lg:gap-8">
          {/* Brand */}
          <div>
            <Logo variant="light" />
            <p className="mt-5 max-w-xs text-sm leading-6 text-white/70">
              {SITE.name} is a home services connection and referral platform. We help homeowners explore
              service categories and call the service line assigned to the trade they need, connecting them
              with independent local providers.
            </p>
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/65">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              We are not a contractor and do not perform home repairs. Providers are independent businesses.
            </p>
            <button
              type="button"
              onClick={() => open()}
              className="btn-accent btn-sm mt-6"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call Now
            </button>
          </div>

          {/* Company */}
          <nav aria-label="Company">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-white">Company</h2>
            <ul className="mt-4 space-y-2.5">
              {FOOTER_COMPANY_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={footerLink}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Services */}
          <nav aria-label="Service categories">
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-white">
              Services
            </h2>
            <ul className="mt-4 space-y-2.5">
              {SERVICE_CATEGORIES.map((category) => (
                <li key={category.id}>
                  <Link to="/services" className={footerLink}>
                    {category.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/services" className={`${footerLink} font-semibold text-white/85`}>
                  All {SERVICES.length} services
                </Link>
              </li>
              <li>
                <Link to="/blog" className={`${footerLink} font-semibold text-white/85`}>
                  Homeowner guides
                </Link>
              </li>
            </ul>
          </nav>

          {/* Contact */}
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-white">Contact</h2>
            <ul className="mt-4 space-y-3">
              {hasPhone() ? (
                <li>
                  <a href={telHref() as string} className="flex items-center gap-2.5 text-sm text-white/80 hover:text-white">
                    <Phone className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                    {SITE.contact.phoneDisplay}
                  </a>
                </li>
              ) : null}
              <li>
                <a
                  href={`mailto:${SITE.contact.email}`}
                  className="flex items-start gap-2.5 break-all text-sm text-white/80 hover:text-white"
                >
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                  {SITE.contact.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5 text-sm text-white/70">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                <span>{SITE.contact.supportHours}</span>
              </li>
              {SITE.contact.addressLines.length > 0 ? (
                <li className="flex items-start gap-2.5 text-sm text-white/70">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" />
                  <span>
                    {SITE.contact.addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </span>
                </li>
              ) : null}
            </ul>

            {socialEntries.length > 0 ? (
              <ul className="mt-5 flex flex-wrap gap-2">
                {socialEntries.map(([name, url]) => (
                  <li key={name}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold capitalize text-white/70 transition-colors hover:border-white/30 hover:text-white"
                    >
                      {name}
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}

            <Link
              to="/contact"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200"
            >
              Send us a message
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {/* Popular services */}
        <div className="mt-12 border-t border-white/10 pt-8">
          <h2 className="text-2xs font-bold uppercase tracking-[0.16em] text-white/40">Popular services</h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {SERVICES.map((service) => (
              <li key={service.slug}>
                <Link to={servicePath(service.slug)} className="text-[0.8125rem] text-white/65 transition-colors hover:text-white">
                  {service.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-4 py-6 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-xs text-white/65">
            © {year} {SITE.legalName}. All rights reserved.
          </p>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              {FOOTER_LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-xs text-white/70 transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('shn:open-cookie-consent'))}
                  className="text-xs text-white/70 transition-colors hover:text-white"
                >
                  Cookie settings
                </button>
              </li>
            </ul>
          </nav>
        </div>
        <div className="container-page pb-6">
          <p className="text-2xs leading-5 text-white/60">
            {SITE.name} is a free home services connection and referral platform. We may receive compensation
            from participating providers. Availability, pricing, licensing and scheduling are set by
            independent providers, and service availability depends on provider coverage in your area. See our{' '}
            <Link to="/disclaimer" className="underline decoration-white/30 underline-offset-2 hover:text-white/70">
              Disclaimer
            </Link>{' '}
            and{' '}
            <Link to="/terms-and-conditions" className="underline decoration-white/30 underline-offset-2 hover:text-white/70">
              Terms &amp; Conditions
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  )
}
