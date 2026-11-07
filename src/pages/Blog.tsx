import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, CalendarDays, Clock, Search } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { PageHero } from '@/components/PageHero'
import { CtaBand } from '@/components/CtaBand'
import {
  blogIsDemo,
  fetchCategories,
  fetchPosts,
  formatBlogDate,
  type BlogCategory,
  type BlogPostSummary,
} from '@/lib/api/blog'

const PER_PAGE = 9

const PostCard = ({ post }: { post: BlogPostSummary }) => (
  <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
    <Link to={`/blog/${post.slug}`} className="block aspect-[16/9] overflow-hidden bg-soft">
      {post.featured_image ? (
        <img
          src={post.featured_image}
          alt={post.featured_image_alt ?? ''}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <span className="flex h-full items-center justify-center text-muted">
          <BookOpen className="h-8 w-8" aria-hidden="true" />
        </span>
      )}
    </Link>
    <div className="flex flex-1 flex-col p-5">
      {post.category ? (
        <Link
          to={`/blog/category/${post.category.slug}`}
          className="text-2xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 hover:underline"
        >
          {post.category.name}
        </Link>
      ) : null}
      <h2 className="mt-1.5 font-display text-base font-bold leading-snug text-ink">
        <Link to={`/blog/${post.slug}`} className="hover:text-brand-700 dark:hover:text-brand-300">
          {post.title}
        </Link>
      </h2>
      {post.excerpt ? <p className="mt-2 line-clamp-3 text-[0.8125rem] leading-6 text-muted">{post.excerpt}</p> : null}
      <div className="mt-auto flex items-center gap-3 pt-4 text-2xs text-muted">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-3 w-3" aria-hidden="true" />
          {formatBlogDate(post.published_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
          Read the guide
        </span>
      </div>
    </div>
  </article>
)

export const Blog = () => {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page') ?? '1'))
  const category = params.get('category') ?? ''
  const query = params.get('q') ?? ''

  const [search, setSearch] = useState(query)
  const [posts, setPosts] = useState<BlogPostSummary[]>([])
  const [categories, setCategories] = useState<BlogCategory[]>([])
  const [total, setTotal] = useState(0)
  const [lastPage, setLastPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useSeo({
    title: 'Home Service Guides & Maintenance Advice',
    description:
      'Practical, plain-English guides for US homeowners: repair or replace decisions, seasonal maintenance checklists, what to ask a contractor and when to call a professional.',
    path: '/blog',
    jsonLd: [
      breadcrumbJsonLd([
        { name: 'Home', path: '/' },
        { name: 'Blog', path: '/blog' },
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'Safe Home Network — Home Service Guides',
        url: 'https://safehomenetwork.com/blog',
      },
    ],
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      fetchPosts({ page, perPage: PER_PAGE, category: category || undefined, q: query || undefined }),
      fetchCategories().catch(() => [] as BlogCategory[]),
    ])
      .then(([result, categoryList]) => {
        if (cancelled) return
        setPosts(result.items)
        setTotal(result.total)
        setLastPage(result.lastPage)
        setCategories(categoryList)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'The articles could not be loaded right now. Please try again in a moment.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, category, query])

  const activeCategory = useMemo(() => categories.find((item) => item.slug === category), [categories, category])

  const update = (changes: Record<string, string>): void => {
    const next = new URLSearchParams(params)
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    if (changes.q !== undefined || changes.category !== undefined) next.delete('page')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHero
        eyebrow="Homeowner guides"
        title={activeCategory ? activeCategory.name : 'Practical guides for the home you own'}
        description={
          activeCategory?.description ??
          'Straight answers on repairs, replacements and maintenance — written for homeowners, not contractors. Every guide explains what to check, what to ask and when a professional is the right call.'
        }
        crumbs={[{ label: 'Blog' }]}
      />

      <section className="section pt-8 sm:pt-10">
        <div className="container-page">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <form
              className="relative w-full max-w-md"
              onSubmit={(event) => {
                event.preventDefault()
                update({ q: search.trim() })
              }}
            >
              <label htmlFor="blog-search" className="sr-only">
                Search guides
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="blog-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search guides — e.g. roof leak, no cooling, low pressure"
                className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-24 text-sm text-ink placeholder:text-muted focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <button type="submit" className="btn-secondary absolute right-1.5 top-1.5 h-8 px-3 text-xs">
                Search
              </button>
            </form>

            <p className="text-xs text-muted">
              {loading ? 'Loading…' : `${total} guide${total === 1 ? '' : 's'}`}
              {query ? ` matching “${query}”` : ''}
            </p>
          </div>

          {categories.length > 0 ? (
            <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => update({ category: '' })}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  category === ''
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-line bg-surface text-muted hover:border-brand-300 hover:text-ink'
                }`}
              >
                All topics
              </button>
              {categories.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => update({ category: item.slug })}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    category === item.slug
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-line bg-surface text-muted hover:border-brand-300 hover:text-ink'
                  }`}
                >
                  {item.name}
                  <span className="ml-1 opacity-60">{item.post_count}</span>
                </button>
              ))}
            </div>
          ) : null}

          {blogIsDemo() ? (
            <p className="mt-6 rounded-xl border border-line bg-soft px-4 py-3 text-sm text-muted">
              <span className="font-semibold text-ink">Sample content.</span> These guides ship with the demo build. Connect
              the CMS (<code className="rounded bg-white px-1">VITE_API_BASE_URL</code>) and import the blog content to
              publish your own schedule.
            </p>
          ) : null}

          <div className="mt-8">
            {loading ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-72 animate-pulse rounded-2xl border border-line bg-soft/60" />
                ))}
              </div>
            ) : error ? (
              <div className="card p-8 text-center">
                <p className="font-display text-lg font-bold text-ink">Articles could not be loaded</p>
                <p className="mt-1 text-sm text-muted">{error}</p>
              </div>
            ) : posts.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="font-display text-lg font-bold text-ink">No guides match that search</p>
                <p className="mt-1 text-sm text-muted">
                  Try a broader term, or{' '}
                  <button type="button" className="font-semibold text-brand-700 underline" onClick={() => update({ q: '', category: '' })}>
                    browse every article
                  </button>
                  .
                </p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>
            )}
          </div>

          {lastPage > 1 ? (
            <nav className="mt-8 flex items-center justify-between gap-3" aria-label="Blog pagination">
              <Link
                to={`/blog?${new URLSearchParams({ ...(category ? { category } : {}), ...(query ? { q: query } : {}), page: String(Math.max(1, page - 1)) }).toString()}`}
                aria-disabled={page <= 1}
                className={`btn-secondary text-sm ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
              >
                Newer
              </Link>
              <span className="text-xs text-muted">
                Page {page} of {lastPage}
              </span>
              <Link
                to={`/blog?${new URLSearchParams({ ...(category ? { category } : {}), ...(query ? { q: query } : {}), page: String(Math.min(lastPage, page + 1)) }).toString()}`}
                aria-disabled={page >= lastPage}
                className={`btn-secondary text-sm ${page >= lastPage ? 'pointer-events-none opacity-40' : ''}`}
              >
                Older
              </Link>
            </nav>
          ) : null}

          <p className="mt-8 flex items-center gap-1.5 text-2xs text-muted">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Guides are reviewed periodically. They are general information, not a quote or a diagnosis — a licensed
            professional confirms the work on site.
          </p>
        </div>
      </section>

      <CtaBand
        headline="Need help with the problem you just read about?"
        description="Pick the trade and call the published service line. The provider confirms scope, pricing and availability with you directly."
        secondaryLabel="Browse services"
        secondaryTo="/services"
      />
    </>
  )
}

export default Blog
