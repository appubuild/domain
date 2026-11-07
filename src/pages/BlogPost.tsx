import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CalendarDays, Clock, ListTree, Phone, UserRound } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { PageHero } from '@/components/PageHero'
import { CtaBand } from '@/components/CtaBand'
import { SITE } from '@/config/site'
import { SERVICES, servicePath } from '@/config/services'
import { fetchPost, formatBlogDate, withHeadingIds, type BlogPostDetail } from '@/lib/api/blog'

/** Maps a blog category to the service page the CTA should open. */
const CATEGORY_SERVICE: Record<string, string> = {
  // Categories that are not also a service page map to nothing, so the article
  // simply omits the call block instead of linking to a 404.
  'appliance-repair': '',
  'hiring-a-pro': '',
}

const serviceForCategory = (slug: string | undefined): string | undefined => {
  if (!slug) return undefined
  const mapped = CATEGORY_SERVICE[slug] ?? slug
  return SERVICES.some((service) => service.slug === mapped) ? mapped : undefined
}

export const BlogPost = () => {
  const { slug = '' } = useParams<{ slug: string }>()
  const [post, setPost] = useState<BlogPostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPost(slug)
      .then((result) => {
        if (cancelled) return
        setPost(result)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'This article could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const { html, toc } = useMemo(() => (post ? withHeadingIds(post.body ?? '') : { html: '', toc: [] }), [post])

  const canonicalPath = post?.canonical_url && post.canonical_url.startsWith('http') ? post.canonical_url : `/blog/${slug}`
  const description =
    post?.seo_description ?? post?.excerpt ?? 'A practical guide for homeowners from Safe Home Network.'
  const serviceSlug = serviceForCategory(post?.category?.slug)

  useSeo({
    title: post?.seo_title ?? post?.title ?? 'Guide',
    description,
    path: canonicalPath,
    image: post?.social_image ?? post?.featured_image ?? undefined,
    type: 'article',
    noindex: post ? post.noindex === 1 || Boolean(post.canonical_url?.startsWith('http')) : false,
    jsonLd: post
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description,
            image: post.featured_image ? [`${SITE.url}${post.featured_image}`] : undefined,
            datePublished: post.published_at ? new Date(post.published_at.replace(' ', 'T') + 'Z').toISOString() : undefined,
            dateModified: post.updated_at ? new Date(post.updated_at.replace(' ', 'T') + 'Z').toISOString() : undefined,
            author: { '@type': 'Organization', name: post.author || SITE.name },
            publisher: {
              '@type': 'Organization',
              name: SITE.name,
              logo: { '@type': 'ImageObject', url: `${SITE.url}/favicon.svg` },
            },
            mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE.url}/blog/${post.slug}` },
            articleSection: post.category?.name,
            keywords: [post.focus_keyword, post.secondary_keywords].filter(Boolean).join(', ') || undefined,
          },
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            ...(post.category ? [{ name: post.category.name, path: `/blog/category/${post.category.slug}` }] : []),
            { name: post.title, path: `/blog/${post.slug}` },
          ]),
        ]
      : undefined,
  })

  if (loading) {
    return (
      <section className="section">
        <div className="container-page max-w-3xl animate-pulse space-y-4">
          <div className="h-4 w-32 rounded bg-soft" />
          <div className="h-10 w-full rounded bg-soft" />
          <div className="h-64 w-full rounded-2xl bg-soft" />
          <div className="h-4 w-full rounded bg-soft" />
          <div className="h-4 w-5/6 rounded bg-soft" />
        </div>
      </section>
    )
  }

  if (error || !post) {
    return (
      <>
        <PageHero
          eyebrow="Article"
          title="This guide is not available"
          description="It may have been unpublished, rescheduled, or the link may be mistyped."
          crumbs={[{ label: 'Blog', to: '/blog' }, { label: 'Not found' }]}
        />
        <section className="section">
          <div className="container-page">
            <Link to="/blog" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the blog
            </Link>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <PageHero
        eyebrow={post.category?.name ?? 'Homeowner guide'}
        title={post.title}
        description={post.excerpt ?? undefined}
        crumbs={[{ label: 'Blog', to: '/blog' }, { label: post.title }]}
      >
        <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
            {post.author}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <time dateTime={post.published_at ?? undefined}>{formatBlogDate(post.published_at)}</time>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {post.read_time_minutes} min read
          </span>
        </div>
      </PageHero>

      <section className="section pt-8 sm:pt-10">
        <div className="container-page">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
            <article className="shn-article">
              {post.featured_image ? (
                <figure className="overflow-hidden rounded-2xl border border-line bg-soft">
                  <img
                    src={post.featured_image}
                    alt={post.featured_image_alt ?? post.title}
                    className="aspect-[16/9] w-full object-cover"
                  />
                </figure>
              ) : null}

              <div className="shn-prose mt-6" dangerouslySetInnerHTML={{ __html: html }} />

              {post.tags.length > 0 ? (
                <div className="mt-8 flex flex-wrap gap-2 border-t border-line pt-5">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag.id}
                      to={`/blog?tag=${encodeURIComponent(tag.slug)}`}
                      className="rounded-full border border-line px-2.5 py-1 text-2xs font-medium text-muted transition hover:border-brand-300 hover:text-brand-700"
                    >
                      #{tag.name}
                    </Link>
                  ))}
                </div>
              ) : null}

              <aside className="mt-8 rounded-2xl border border-line bg-soft/70 p-5">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted">A note on this guide</p>
                <p className="mt-1.5 text-xs leading-6 text-muted">
                  Safe Home Network is a connection and referral platform, not a contractor. This article is general
                  information for homeowners; it is not a diagnosis, a quote or a guarantee of any outcome. Work that
                  involves gas, mains wiring, structural changes or height should be carried out by a licensed
                  professional.
                </p>
              </aside>
            </article>

            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              {toc.length > 1 ? (
                <nav className="card p-5" aria-label="On this page">
                  <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted">
                    <ListTree className="h-3.5 w-3.5" aria-hidden="true" /> On this page
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {toc.slice(0, 12).map((item) => (
                      <li key={item.id} className={item.level === 3 ? 'pl-3' : ''}>
                        <a href={`#${item.id}`} className="text-xs leading-5 text-muted hover:text-brand-700 hover:underline">
                          {item.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : null}

              <div className="card p-5">
                <p className="font-display text-sm font-bold text-ink">Need help with this?</p>
                <p className="mt-1 text-xs leading-6 text-muted">
                  Call the service line for {post.category?.name ?? 'home services'} and speak with an independent
                  provider who covers your area.
                </p>
                <Link to={serviceSlug ? servicePath(serviceSlug) : '/services'} className="btn-primary mt-3 w-full text-sm">
                  <Phone className="h-4 w-4" aria-hidden="true" /> Service options
                </Link>
                <Link to="/services" className="btn-secondary mt-2 w-full text-sm">
                  All services <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </aside>
          </div>

          {post.related.length > 0 ? (
            <div className="mt-12 border-t border-line pt-8">
              <h2 className="font-display text-lg font-bold text-ink">Related guides</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {post.related.map((item) => (
                  <Link
                    key={item.slug}
                    to={`/blog/${item.slug}`}
                    className="group flex gap-3 rounded-xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:shadow-card"
                  >
                    {item.featured_image ? (
                      <img
                        src={item.featured_image}
                        alt={item.featured_image_alt ?? ''}
                        loading="lazy"
                        className="h-16 w-20 shrink-0 rounded-lg object-cover"
                      />
                    ) : null}
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-ink group-hover:text-brand-700">
                        {item.title}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-2xs text-muted">{item.excerpt}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <CtaBand
        headline="Want to talk to someone about your home?"
        description="Pick the trade you need and call the published service line — no ZIP code required."
        secondaryLabel="Browse all services"
        secondaryTo="/services"
        serviceSlug={serviceSlug}
      />
    </>
  )
}

export default BlogPost
