import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBlogPosts } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, BreadcrumbBar, CtaBand } from '@/components/shared/sections';
import { Badge, Button, Card, CardContent, Input, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function BlogPage() {
  const navigate = useNavigate();
  const { data: posts, isLoading, isError, refetch } = useBlogPosts();
  const [query, setQuery] = React.useState('');
  const [tag, setTag] = React.useState<string | null>(null);

  const published = React.useMemo(() => (posts ?? []).filter((post) => post.status === 'published'), [posts]);
  const featured = published.find((post) => post.featured) ?? published[0];
  const tags = React.useMemo(() => Array.from(new Set(published.flatMap((post) => post.tags))).slice(0, 10), [published]);

  const filtered = React.useMemo(() => {
    let list = published.filter((post) => post.id !== featured?.id);
    if (query.trim()) {
      const lower = query.toLowerCase();
      list = list.filter((post) => post.title.toLowerCase().includes(lower) || post.excerpt.toLowerCase().includes(lower));
    }
    if (tag) list = list.filter((post) => post.tags.includes(tag));
    return list;
  }, [published, featured, query, tag]);

  return (
    <>
      <Seo
        title="Blog — writing, design and self-publishing craft"
        description="Articles on book structure, cover design, print requirements, EPUB production, AI-assisted writing and author data."
        canonical="/blog"
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Blog' }]} />
          <SectionHeading
            eyebrow="Blog"
            title="Craft notes from building a publishing platform"
            description="Practical articles about structure, typography, print requirements and what our author data actually shows."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search articles…"
              aria-label="Search articles"
              className="max-w-xs"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTag(null)}
                className={cn('rounded-full border px-3 py-1.5 text-xs', !tag ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
              >
                All topics
              </button>
              {tags.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setTag(entry === tag ? null : entry)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs', tag === entry ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground')}
                >
                  #{entry}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {isError ? (
        <div className="container py-16">
          <ErrorState title="Articles could not load" onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="container grid gap-6 py-10 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {featured && (
            <Section>
              <Link to={`/blog/${featured.slug}`} className="group block overflow-hidden rounded-2xl border border-border bg-card">
                <div className="grid lg:grid-cols-[1.2fr_1fr]">
                  <div className="p-6 sm:p-8">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="accent">Featured</Badge>
                      <Badge variant="secondary">{featured.category}</Badge>
                    </div>
                    <h2 className="mt-3 font-display text-2xl font-bold text-foreground group-hover:text-primary sm:text-3xl">{featured.title}</h2>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{featured.excerpt}</p>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {featured.author} · {formatDate(featured.publishedAt)} · {featured.readMinutes} min read
                    </p>
                    <span className="mt-4 inline-block text-sm font-medium text-primary">Read the article →</span>
                  </div>
                  <div className="min-h-[200px]" style={{ background: featured.coverGradient }} aria-hidden />
                </div>
              </Link>
            </Section>
          )}

          <Section tone="muted">
            <SectionHeading title={tag ? `Articles tagged #${tag}` : 'Latest articles'} description={`${filtered.length} ${filtered.length === 1 ? 'article' : 'articles'}`} align="left" />
            {!filtered.length ? (
              <div className="mt-6">
                <EmptyState
                  icon="◫"
                  title="No articles match that filter"
                  actions={
                    <Button variant="outline" onClick={() => { setQuery(''); setTag(null); }}>
                      Clear filters
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((post) => (
                  <Card key={post.id} className="flex flex-col overflow-hidden p-0">
                    <Link to={`/blog/${post.slug}`} className="block">
                      <div className="h-32" style={{ background: post.coverGradient }} aria-hidden />
                    </Link>
                    <CardContent className="flex flex-1 flex-col">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{post.category}</Badge>
                      </div>
                      <Link to={`/blog/${post.slug}`} className="mt-2.5 block">
                        <h3 className="text-sm font-semibold leading-snug text-foreground hover:text-primary">{post.title}</h3>
                      </Link>
                      <p className="mt-1.5 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">{post.excerpt}</p>
                      <p className="mt-3 text-2xs text-muted-foreground">
                        {formatDate(post.publishedAt)} · {post.readMinutes} min read
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <Section>
        <CtaBand
          title="Subscribe by writing, not by email"
          description="Start a free project and you will see these ideas applied in the editor, with real preflight feedback on your own pages."
          primaryLabel="Start writing free"
          secondaryLabel="Read the FAQ"
          secondaryHref="/faq"
        />
      </Section>
    </>
  );
}
