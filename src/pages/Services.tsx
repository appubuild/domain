import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Phone, Search, SlidersHorizontal, X } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { SERVICE_CATEGORIES, SERVICES } from '@/config/services'
import { PageHero } from '@/components/PageHero'
import { ServiceCard } from '@/components/ServiceCard'
import { CtaBand } from '@/components/CtaBand'
import { Reveal } from '@/components/Reveal'
import { ServiceIcon } from '@/components/ServiceIcon'
import { useCallSheet } from '@/components/calls/CallContext'

const matchesQuery = (serviceName: string, description: string, terms: string[] | undefined, query: string) => {
  const haystack = [serviceName, description, ...(terms ?? [])].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

const Services = () => {
  const [params, setParams] = useSearchParams()
  const { open } = useCallSheet()
  const query = params.get('q') ?? ''
  const category = params.get('category') ?? 'all'

  const updateParams = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params)
    Object.entries(next).forEach(([key, value]) => {
      if (!value || value === 'all' || value === '') merged.delete(key)
      else merged.set(key, value)
    })
    setParams(merged, { replace: true })
  }

  const filtered = useMemo(
    () =>
      SERVICES.filter((service) => {
        const categoryOk = category === 'all' || service.category === category
        const queryOk = query
          ? matchesQuery(service.name, service.shortDescription, service.searchTerms, query)
          : true
        return categoryOk && queryOk
      }),
    [category, query],
  )

  const activeFilters = Boolean(query) || category !== 'all'

  useSeo({
    title: 'Home Services Directory — All Categories',
    description: `Browse ${SERVICES.length} home service categories, compare what each project involves, and call the service line assigned to the trade you need.`,
    path: '/services',
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Services', path: '/services' },
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Safe Home Network service directory',
        itemListElement: SERVICES.map((service, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: service.name,
          url: `https://safehomenetwork.com/services/${service.slug}`,
        })),
      },
    ],
  })

  return (
    <>
      <PageHero
        eyebrow="Service directory"
        title="Every home service category, in one organized place"
        description="Browse by trade or search for what you need. Each category explains what the work involves and shows the call line assigned to that service."
        crumbs={[{ label: 'Services' }]}
      >
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => open()} className="btn-primary">
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call Now
          </button>
          <Link to="/how-it-works" className="btn-secondary">
            How connections work
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </PageHero>

      <section className="section pt-10 sm:pt-12">
        <div className="container-page">
          {/* Toolbar */}
          <div className="card p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm">
                <label htmlFor="service-search" className="sr-only">
                  Search services
                </label>
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  aria-hidden="true"
                />
                <input
                  id="service-search"
                  type="search"
                  value={query}
                  onChange={(event) => updateParams({ q: event.target.value })}
                  placeholder="Search services, e.g. roof, leak, panel…"
                  className="input pl-10 pr-10"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => updateParams({ q: null })}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted transition-colors hover:bg-soft hover:text-ink"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-2 text-sm text-muted">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span aria-live="polite">
                  {filtered.length} {filtered.length === 1 ? 'service' : 'services'}
                  {activeFilters ? ' match your filters' : ' available'}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => updateParams({ category: 'all' })}
                aria-pressed={category === 'all'}
                className={`rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                  category === 'all'
                    ? 'border-transparent bg-navy-900 text-white'
                    : 'border-line bg-surface text-muted hover:border-brand-300 hover:text-ink'
                }`}
              >
                All services
              </button>
              {SERVICE_CATEGORIES.map((item) => {
                const count = SERVICES.filter((service) => service.category === item.id).length
                const isActive = category === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateParams({ category: isActive ? 'all' : item.id })}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                      isActive
                        ? 'border-transparent bg-navy-900 text-white'
                        : 'border-line bg-surface text-muted hover:border-brand-300 hover:text-ink'
                    }`}
                  >
                    {item.name}
                    <span className={isActive ? 'text-white/60' : 'text-muted/70'}>{count}</span>
                  </button>
                )
              })}
              {activeFilters ? (
                <button
                  type="button"
                  onClick={() => setParams(new URLSearchParams(), { replace: true })}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[0.8125rem] font-semibold text-brand-700 hover:underline dark:text-brand-300"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset filters
                </button>
              ) : null}
            </div>
          </div>

          {/* Results */}
          {filtered.length > 0 ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((service, index) => (
                <Reveal key={service.slug} delay={(index % 3) * 70} className="h-full">
                  <ServiceCard service={service} />
                </Reveal>
              ))}
            </div>
          ) : (
            <div className="card mt-8 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <Search className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 font-display text-lg font-bold text-ink">No services match that search</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
                Try a broader term — for example “roof”, “leak”, “cooling” or “panel” — or reset the filters to
                see every category.
              </p>
              <button
                type="button"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
                className="btn-primary mt-5"
              >
                Show all services
              </button>
            </div>
          )}

          {/* Category explainer */}
          <div className="mt-12 rounded-2xl border border-line bg-soft p-6 sm:p-8">
            <h2 className="font-display text-lg font-bold text-ink">How the categories are organized</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICE_CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => updateParams({ category: item.id })}
                  className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand-300"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                    <ServiceIcon
                      name={SERVICES.find((service) => service.category === item.id)?.icon ?? 'wrench'}
                      className="h-4 w-4"
                    />
                  </span>
                  <span>
                    <span className="block font-display text-sm font-bold text-ink group-hover:text-brand-700 dark:group-hover:text-brand-300">
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{item.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CtaBand
        headline="Not sure which category fits your project?"
        description="Tell us what is going on and our team will point you toward the right service category and the line to call."
        primaryLabel="Call Now"
        secondaryLabel="Contact our team"
        secondaryTo="/contact"
      />
    </>
  )
}

export default Services
