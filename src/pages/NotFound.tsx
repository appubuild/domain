import { Link } from 'react-router-dom'
import { ArrowRight, Home as HomeIcon, MapPin, Search } from 'lucide-react'
import { useSeo } from '@/lib/seo'
import { SERVICES, servicePath } from '@/config/services'
import { useAvailability } from '@/components/availability/AvailabilityContext'

const NotFound = () => {
  const { open } = useAvailability()
  const suggestions = SERVICES.slice(0, 6)

  useSeo({
    title: 'Page Not Found',
    description: 'The page you were looking for could not be found on Safe Home Network.',
    path: '/404',
    noindex: true,
  })

  return (
    <section className="section">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="font-display text-6xl font-extrabold text-brand-600 dark:text-brand-400 sm:text-7xl">404</p>
          <h1 className="mt-4 font-display text-2xl font-extrabold text-ink sm:text-3xl">
            We could not find that page
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-[0.9375rem] leading-7 text-muted">
            The link may be outdated, or the page may have moved. Try the service directory or check
            availability in your ZIP code instead.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/" className="btn-primary">
              <HomeIcon className="h-4 w-4" aria-hidden="true" />
              Back to home
            </Link>
            <Link to="/services" className="btn-secondary">
              <Search className="h-4 w-4" aria-hidden="true" />
              Browse services
            </Link>
            <button type="button" onClick={() => open()} className="btn-secondary">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Check ZIP code
            </button>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-3xl">
          <p className="text-center text-2xs font-bold uppercase tracking-[0.16em] text-muted">
            Popular categories
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {suggestions.map((service) => (
              <li key={service.slug}>
                <Link
                  to={servicePath(service.slug)}
                  className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink transition-colors hover:border-brand-300 hover:text-brand-700 dark:hover:text-brand-300"
                >
                  {service.name}
                  <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export default NotFound
