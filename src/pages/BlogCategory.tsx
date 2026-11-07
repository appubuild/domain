import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useSeo, breadcrumbJsonLd } from '@/lib/seo'
import { PageHero } from '@/components/PageHero'
import { CtaBand } from '@/components/CtaBand'
import { fetchCategory, formatBlogDate, type BlogCategory as Category, type BlogPostSummary } from '@/lib/api/blog'

export const BlogCategory = () => {
  const { slug = '' } = useParams<{ slug: string }>()
  const [category, setCategory] = useState<Category | null>(null)
  const [posts, setPosts] = useState<BlogPostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCategory(slug)
      .then((result) => {
        if (cancelled) return
        setCategory(result.category)
        setPosts(result.posts)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : 'This category could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useSeo({
    title: category?.seo_title ?? (category ? `${category.name} guides` : 'Blog category'),
    description:
      category?.seo_description ??
      category?.description ??
      'Practical guides for US homeowners, grouped by trade.',
    path: `/blog/category/${slug}`,
    noindex: category ? category.noindex === 1 : false,
    jsonLd: category
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: category.name,
            description: category.description ?? undefined,
            url: `https://safehomenetwork.com/blog/category/${category.slug}`,
          },
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: category.name, path: `/blog/category/${category.slug}` },
          ]),
        ]
      : undefined,
  })

  if (loading) {
    return (
      <section className="section">
        <div className="container-page grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-2xl border border-line bg-soft/60" />
          ))}
        </div>
      </section>
    )
  }

  if (error || !category) {
    return (
      <>
        <PageHero
          eyebrow="Blog"
          title="Category not found"
          description="That topic may have been renamed or removed."
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
        eyebrow={`${category.post_count} article${category.post_count === 1 ? '' : 's'}`}
        title={category.name}
        description={category.description ?? `Guides grouped under ${category.name}.`}
        crumbs={[{ label: 'Blog', to: '/blog' }, { label: category.name }]}
      />

      <section className="section pt-8 sm:pt-10">
        <div className="container-page">
          {posts.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="font-display text-lg font-bold text-ink">No published articles in this topic yet</p>
              <p className="mt-1 text-sm text-muted">New guides appear here as soon as they are published.</p>
              <Link to="/blog" className="btn-secondary mt-4">
                Browse all guides
              </Link>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article key={post.id} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
                  <Link to={`/blog/${post.slug}`} className="block aspect-[16/9] overflow-hidden bg-soft">
                    {post.featured_image ? (
                      <img
                        src={post.featured_image}
                        alt={post.featured_image_alt ?? ''}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : null}
                  </Link>
                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="font-display text-base font-bold leading-snug text-ink">
                      <Link to={`/blog/${post.slug}`} className="hover:text-brand-700">
                        {post.title}
                      </Link>
                    </h2>
                    {post.excerpt ? <p className="mt-2 line-clamp-3 text-[0.8125rem] leading-6 text-muted">{post.excerpt}</p> : null}
                    <p className="mt-auto flex items-center gap-1.5 pt-4 text-2xs text-muted">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {formatBlogDate(post.published_at)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="mt-8">
            <Link to="/blog" className="btn-secondary text-sm">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All guides
            </Link>
          </div>
        </div>
      </section>

      <CtaBand
        headline={`Need ${category.name.toLowerCase()} help?`}
        description="Call the published service line for this trade — the provider confirms availability in your area."
        secondaryLabel="Browse services"
        secondaryTo="/services"
      />
    </>
  )
}

export default BlogCategory
