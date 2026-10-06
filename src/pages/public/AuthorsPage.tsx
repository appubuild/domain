import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthors } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Avatar, Badge, Button, Card, CardContent, Input, Rating, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';

export default function AuthorsPage() {
  const navigate = useNavigate();
  const { data: authors, isLoading, isError, refetch } = useAuthors();
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<'books' | 'followers' | 'rating'>('followers');

  const entries = React.useMemo(
    () =>
      (authors ?? []).map((entry) => ({
        userId: entry.profile.userId,
        name: entry.profile.name,
        username: entry.profile.username,
        avatarUrl: entry.profile.avatarUrl,
        tagline: entry.profile.tagline,
        bio: entry.profile.bio,
        location: entry.profile.location,
        followers: entry.profile.followers,
        rating: entry.profile.rating,
        totalBooks: entry.profile.totalBooks,
      })),
    [authors],
  );

  const filtered = React.useMemo(() => {
    let list = [...entries];
    if (query.trim()) {
      const lower = query.toLowerCase();
      list = list.filter(
        (author) =>
          author.name.toLowerCase().includes(lower) ||
          author.username.toLowerCase().includes(lower) ||
          author.tagline.toLowerCase().includes(lower),
      );
    }
    return list.sort((a, b) => {
      if (sort === 'books') return b.totalBooks - a.totalBooks;
      if (sort === 'rating') return b.rating - a.rating;
      return b.followers - a.followers;
    });
  }, [entries, query, sort]);

  return (
    <>
      <Seo
        title="Authors publishing with Scriptora"
        description="Browse independent authors publishing on Scriptora. Follow their profiles, read their books and see what they are releasing next."
        canonical="/authors"
        keywords={['indie authors', 'self published authors', 'author directory']}
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Authors' }]} />
          <SectionHeading
            eyebrow="Authors"
            title="The people behind the books"
            description="Every author here writes, designs and publishes their own work. Follow a profile to hear about the next release."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search authors by name, handle or tagline…"
              aria-label="Search authors"
              className="max-w-sm"
            />
            <div className="flex rounded-lg border border-input" role="group" aria-label="Sort authors">
              {([
                ['followers', 'Most followed'],
                ['books', 'Most books'],
                ['rating', 'Highest rated'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSort(value)}
                  aria-pressed={sort === value}
                  className={sort === value ? 'bg-primary/10 px-3 py-2 text-xs font-medium text-primary' : 'px-3 py-2 text-xs text-muted-foreground'}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="self-center text-xs text-muted-foreground">{filtered.length} authors</span>
          </div>
        </div>
      </section>

      <Section>
        {isError ? (
          <ErrorState title="Authors could not load" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : !filtered.length ? (
          <EmptyState icon="☺" title="No authors match that search" description="Try a different name or clear the search." actions={<Button variant="outline" onClick={() => setQuery('')}>Clear search</Button>} />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((author) => (
              <Card key={author.userId} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col">
                  <div className="flex items-start gap-4">
                    <Avatar name={author.name} src={author.avatarUrl} size={56} />
                    <div className="min-w-0">
                      <Link to={`/authors/${author.userId}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary">
                        {author.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">@{author.username}</p>
                      <div className="mt-1">
                        <Rating value={author.rating} size={11} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 flex-1 text-sm text-muted-foreground">{author.tagline || author.bio}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-2xs">
                    <Badge variant="secondary">{author.totalBooks} books</Badge>
                    <Badge variant="outline">{author.followers.toLocaleString()} followers</Badge>
                    {author.location && <Badge variant="outline">{author.location}</Badge>}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => navigate(`/authors/${author.userId}`)}>
                      View profile
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/marketplace?author=${author.userId}`)}
                      aria-label={`See books by ${author.name}`}
                    >
                      Books
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section tone="paper">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="font-display text-2xl font-bold text-foreground">Publish your own author page</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Every Scriptora account gets a public author profile with a book shelf, follower count, social links and an about section you control.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => navigate('/register')}>Create your profile</Button>
            <Button variant="outline" onClick={() => navigate('/publishing')}>
              See how publishing works
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}
