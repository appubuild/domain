import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBlogPosts } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { Section, BreadcrumbBar } from '@/components/shared/sections';
import { Avatar, Badge, Button, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { ErrorState } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';

export default function BlogPostPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { success } = useToast();
  const { data: posts, isLoading } = useBlogPosts();
  const [progress, setProgress] = React.useState(0);
  const articleRef = React.useRef<HTMLElement>(null);

  const post = (posts ?? []).find((entry) => entry.slug === slug && entry.status === 'published');
  const related = (posts ?? []).filter((entry) => entry.id !== post?.id && entry.status === 'published').slice(0, 3);

  React.useEffect(() => {
    const onScroll = () => {
      const element = articleRef.current;
      if (!element) return;
      const total = element.scrollHeight - window.innerHeight;
      setProgress(total > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / total) * 100))) : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [post]);

  if (isLoading) {
    return (
      <div className="container space-y-5 py-12">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="container py-16">
        <ErrorState title="Article not found" description="That article may have been unpublished." />
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('/blog')}>Back to the blog</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Seo title={post.title} description={post.excerpt} canonical={`/blog/${post.slug}`} keywords={post.tags} type="article" />
      <div className="sticky top-16 z-30 h-0.5 bg-muted">
        <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} aria-hidden />
      </div>
      <div className="container">
        <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Blog', href: '/blog' }, { label: post.title }]} />
      </div>
      <article ref={articleRef} className="container max-w-3xl pb-10">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{post.category}</Badge>
          {post.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              #{tag}
            </Badge>
          ))}
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{post.title}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{post.excerpt}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-border py-4">
          <div className="flex items-center gap-3">
            <Avatar name={post.author} src={post.authorAvatar} size={40} />
            <div>
              <p className="text-sm font-medium text-foreground">{post.author}</p>
              <p className="text-2xs text-muted-foreground">
                {formatDate(post.publishedAt)} · {post.readMinutes} min read
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                success('Link copied');
              }}
            >
              Copy link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/blog')}>
              All articles
            </Button>
          </div>
        </div>
        <div className="mt-6 h-48 rounded-xl" style={{ background: post.coverGradient }} aria-hidden />
        <div className="prose-scriptora mt-8 space-y-5 text-base leading-relaxed text-foreground">
          {post.body.split('\n\n').map((paragraph, index) => (
            <p key={index} className={index === 0 ? 'text-lg leading-relaxed text-muted-foreground' : ''}>
              {paragraph}
            </p>
          ))}
        </div>
        <div className="mt-10 rounded-xl border border-border bg-muted/40 p-5">
          <p className="text-sm font-semibold text-foreground">Written by {post.author}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Published on the Scriptora blog. We write about book structure, typography, print requirements and what the data says about finishing a manuscript.
          </p>
        </div>
      </article>

      {related.length > 0 && (
        <Section tone="muted">
          <h2 className="font-display text-xl font-bold text-foreground">Keep reading</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-3">
            {related.map((entry) => (
              <Card key={entry.id}>
                <CardContent>
                  <Badge variant="secondary">{entry.category}</Badge>
                  <Link to={`/blog/${entry.slug}`} className="mt-2 block">
                    <h3 className="text-sm font-semibold text-foreground hover:text-primary">{entry.title}</h3>
                  </Link>
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{entry.excerpt}</p>
                  <p className="mt-2 text-2xs text-muted-foreground">{entry.readMinutes} min read</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
