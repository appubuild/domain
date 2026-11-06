import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ArrowRight, ChevronDown, Mail, MapPin, Menu, Phone, X } from 'lucide-react'
import { NAV_LINKS, SITE, hasPhone, telHref } from '@/config/site'
import { SERVICE_CATEGORIES, SERVICES, servicePath } from '@/config/services'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ServiceIcon } from '@/components/ServiceIcon'
import { useAvailability } from '@/components/availability/AvailabilityContext'

const navItemClasses = (isActive: boolean) =>
  `relative rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? 'text-brand-700 dark:text-brand-300'
      : 'text-ink/80 hover:bg-soft hover:text-ink dark:text-white/75 dark:hover:text-white'
  }`

/* -------------------------------------------------------------------------- */
/*  Desktop services dropdown                                                 */
/* -------------------------------------------------------------------------- */

const ServicesMenu = ({ onNavigate }: { onNavigate: () => void }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { open: openChecker } = useAvailability()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const hoverCapable = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => {
        if (hoverCapable()) setOpen(true)
      }}
      onMouseLeave={() => {
        if (hoverCapable()) setOpen(false)
      }}
    >
      <div className="flex items-center">
        <NavLink to="/services" className={({ isActive }) => `${navItemClasses(isActive)} pr-1`} end>
          Services
        </NavLink>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="services-menu"
          aria-label={open ? 'Close service categories' : 'Open service categories'}
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg p-1.5 text-ink/70 transition-colors hover:bg-soft hover:text-ink dark:text-white/70 dark:hover:text-white"
        >
          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {open ? (
        <div
          id="services-menu"
          className="absolute left-1/2 top-full z-50 mt-3 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 animate-slide-down overflow-hidden rounded-2xl border border-line bg-elevated shadow-float"
        >
          <div className="grid gap-x-6 gap-y-5 p-6 sm:grid-cols-2">
            {SERVICE_CATEGORIES.map((category) => (
              <div key={category.id}>
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">{category.name}</p>
                <ul className="mt-2 space-y-0.5">
                  {SERVICES.filter((service) => service.category === category.id).map((service) => (
                    <li key={service.slug}>
                      <Link
                        to={servicePath(service.slug)}
                        onClick={() => {
                          setOpen(false)
                          onNavigate()
                        }}
                        className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink/85 transition-colors hover:bg-soft hover:text-brand-700 dark:text-white/80 dark:hover:text-brand-300"
                      >
                        <ServiceIcon
                          name={service.icon}
                          className="h-4 w-4 shrink-0 text-brand-600 transition-transform group-hover:scale-110 dark:text-brand-400"
                        />
                        {service.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-soft/60 px-6 py-3">
            <Link
              to="/services"
              onClick={() => {
                setOpen(false)
                onNavigate()
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300"
            >
              View all {SERVICES.length} services
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onNavigate()
                openChecker()
              }}
              className="btn-secondary btn-sm"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              Check your ZIP code
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Mobile drawer                                                             */
/* -------------------------------------------------------------------------- */

const MobileDrawer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [servicesExpanded, setServicesExpanded] = useState(false)
  const { open: openChecker } = useAvailability()
  const location = useLocation()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setServicesExpanded(false)
  }, [location.pathname, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[90] lg:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-navy-950/60 backdrop-blur-sm animate-fade-in"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        className="absolute right-0 top-0 flex h-full w-[90%] max-w-sm flex-col border-l border-line bg-elevated shadow-float animate-slide-in-right"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-full p-2 text-muted transition-colors hover:bg-soft hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-4 py-4">
          <ul className="space-y-1">
            {NAV_LINKS.map((link) =>
              link.label === 'Services' ? (
                <li key={link.to}>
                  <div className="flex items-center">
                    <NavLink
                      to={link.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex-1 rounded-xl px-3 py-3 text-[0.9375rem] font-semibold transition-colors ${
                          isActive
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'text-ink hover:bg-soft'
                        }`
                      }
                    >
                      Services
                    </NavLink>
                    <button
                      type="button"
                      aria-expanded={servicesExpanded}
                      aria-controls="mobile-services-list"
                      onClick={() => setServicesExpanded((value) => !value)}
                      className="rounded-xl p-3 text-muted transition-colors hover:bg-soft hover:text-ink"
                      aria-label={servicesExpanded ? 'Collapse service categories' : 'Expand service categories'}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${servicesExpanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <div id="mobile-services-list" hidden={!servicesExpanded} className="mt-1 space-y-3 pl-3">
                    {SERVICE_CATEGORIES.map((category) => (
                      <div key={category.id}>
                        <p className="px-2 text-2xs font-bold uppercase tracking-[0.16em] text-muted">
                          {category.name}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {SERVICES.filter((service) => service.category === category.id).map((service) => (
                            <li key={service.slug}>
                              <Link
                                to={servicePath(service.slug)}
                                onClick={onClose}
                                className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-ink/85 transition-colors hover:bg-soft hover:text-brand-700"
                              >
                                <ServiceIcon name={service.icon} className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                                {service.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <Link
                      to="/services"
                      onClick={onClose}
                      className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-brand-700 dark:text-brand-300"
                    >
                      Browse the full directory
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              ) : (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `block rounded-xl px-3 py-3 text-[0.9375rem] font-semibold transition-colors ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'text-ink hover:bg-soft'
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                </li>
              ),
            )}
          </ul>

          <div className="mt-5 space-y-2">
            <ThemeToggle withLabel />
            <button
              type="button"
              onClick={() => {
                onClose()
                openChecker()
              }}
              className="btn-primary w-full"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Find a Service
            </button>
          </div>

          <div className="mt-6 rounded-xl border border-line bg-soft p-4">
            <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted">Talk to our team</p>
            {hasPhone() ? (
              <a href={telHref() as string} className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink">
                <Phone className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                {SITE.contact.phoneDisplay}
              </a>
            ) : null}
            <a
              href={`mailto:${SITE.contact.email}`}
              className="mt-2 flex items-center gap-2 break-all text-sm font-semibold text-ink"
            >
              <Mail className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
              {SITE.contact.email}
            </a>
            <p className="mt-2 text-xs leading-5 text-muted">{SITE.contact.supportHours}</p>
          </div>
        </nav>
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                    */
/* -------------------------------------------------------------------------- */

export const Header = () => {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { open: openChecker } = useAvailability()
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? 'border-line bg-page/85 shadow-[0_1px_20px_-12px_rgba(16,36,58,0.35)] backdrop-blur-xl'
          : 'border-transparent bg-page/60 backdrop-blur-sm'
      }`}
    >
      <div className="container-page">
        <div className="flex h-16 items-center justify-between gap-4 lg:h-[4.5rem]">
          <Logo />

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) =>
              link.label === 'Services' ? (
                <ServicesMenu key={link.to} onNavigate={() => setMobileOpen(false)} />
              ) : (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) => navItemClasses(isActive)}
                >
                  {link.label}
                </NavLink>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle className="hidden sm:flex" />
            <button
              type="button"
              onClick={() => openChecker()}
              className="btn-primary hidden px-4 py-2.5 text-[0.8125rem] sm:inline-flex lg:px-5 lg:text-sm"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Find a Service
            </button>
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-soft lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <MobileDrawer isOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  )
}
