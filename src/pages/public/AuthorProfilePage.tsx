import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthor, useMarketplace } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { marketplaceService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { BookCard } from '@/components/shared/BookCard';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Avatar, Badge, Button, Card, CardContent, Rating, Skeleton, Textarea } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function AuthorProfilePage() {
  const { authorId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { success, info } = useToast();
  const { data: author, isLoading } = useAuthor(authorId);
  const { data: books } = useMarketplace({
    query: '',
    categoryIds: [],
    priceFilter: 'all',
    minRating: 0,
    sort: 'newest',
    kind: 'all',
  });
  const [following, setFollowing] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [tab, setTab] = React.useState<'books' | 'about' | 'reviews'>('books');

  const authored = React.useMemo(() => (books ?? []).filter((book) => book.ownerId === authorId), [books, authorId]);
  const isSelf = user?.id === authorId;

  if (isLoading) {
    return (
      <div className="container space-y-6 py-10">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!author) {
    return (
      <div className="container py-16">
        <ErrorState title="Author not found" description="This profile may have been removed or renamed." />
        <div className="mt-4 flex justify-center">
          <Button onClick={() => navigate('/authors')}>Browse authors</Button>
        </div>
      </div>
    );
  }

  const reviews = authored.flatMap((book) => (book.marketplace.reviewCount > 0 ? [{ book, rating: book.marketplace.rating, count: book.marketplace.reviewCount }] : []));

  return (
    <>
      <Seo
        title={`${author.name} (@${author.username})`}
        description={author.tagline || author.bio.slice(0, 150)}
        canonical={`/authors/${author.userId}`}
        image={author.avatarUrl}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: author.name,
          description: author.bio,
          url: `${window.location.origin}/authors/${author.userId}`,
        }}
      />
      <div className="container">
        <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Authors', href: '/authors' }, { label: author.name }]} />
      </div>

      <div className="container">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="h-32 bg-brand-gradient" aria-hidden />
          <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
            <div className="-mt-12">
              <div className="rounded-full border-4 border-card bg-card">
                <Avatar name={author.name} src={author.avatarUrl} size={96} />
              </div>
            </div>
            <div className="min-w-0 flex-1 sm:pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-foreground">{author.name}</h1>
                {author.verified && <Badge variant="info">Verified</Badge>}
                {author.featured && <Badge variant="accent">Featured author</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">@{author.username}{author.location ? ` · ${author.location}` : ''}</p>
              <p className="mt-1 text-sm text-muted-foreground">{author.tagline}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span>{author.totalBooks} published books</span>
                <span>{author.followers.toLocaleString()} followers</span>
                <span>{author.totalSales.toLocaleString()} copies sold</span>
                <span className="flex items-center gap-1">
                  <Rating value={author.rating} size={11} /> {author.rating.toFixed(1)}
                </span>
                <span>Joined {formatDate(author.joinedAt)}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:pb-1">
              {isSelf ? (
                <>
                  <Button onClick={() => navigate('/dashboard/profile')}>Edit profile</Button>
                  <Button variant="outline" onClick={() => navigate('/dashboard/books')}>
                    My books
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant={following ? 'outline' : 'default'}
                    onClick={() => {
                      if (!isAuthenticated) return navigate('/login');
                      setFollowing((value) => !value);
                      success(following ? 'Unfollowed' : `Now following ${author.name}`);
                    }}
                  >
                    {following ? 'Following' : 'Follow'}
                  </Button>
                  <Button variant="outline" onClick={() => (isAuthenticated ? setContactOpen(true) : navigate('/login'))}>
                    Message
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${window.location.origin}/authors/${author.userId}`);
                      success('Profile link copied');
                    }}
                  >
                    Share
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-1 border-t border-border px-3" role="tablist" aria-label="Profile sections">
            {([['books', `Books (${authored.length})`], ['about', 'About'], ['reviews', `Ratings (${reviews.length})`]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'border-b-2 px-3.5 py-3 text-sm font-medium transition-colors',
                  tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Section>
        {tab === 'books' && (
          <>
            {!authored.length ? (
              <EmptyState
                icon="▤"
                title="No published books yet"
                description={isSelf ? 'Publish a book to see it here.' : `${author.name} has not published on the marketplace yet.`}
                actions={isSelf ? <Button onClick={() => navigate('/dashboard/books/new')}>Create a book</Button> : undefined}
              />
            ) : (
              <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
                {authored.map((book) => (
                  <BookCard key={book.id} book={book} showAuthor={false} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'about' && (
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardContent>
                <h2 className="text-sm font-semibold text-foreground">Biography</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{author.bio}</p>
                {author.genres.length > 0 && (
                  <>
                    <h3 className="mt-5 text-sm font-semibold text-foreground">Writes in</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {author.genres.map((genre) => (
                        <Badge key={genre} variant="secondary">
                          {genre}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardContent>
                  <h2 className="text-sm font-semibold text-foreground">Links</h2>
                  <ul className="mt-2 space-y-2 text-sm">
                    {[
                      ['Website', author.social.website],
                      ['Twitter', author.social.twitter],
                      ['Instagram', author.social.instagram],
                      ['Goodreads', author.social.goodreads],
                    ]
                      .filter(([, value]) => Boolean(value))
                      .map(([label, value]) => (
                        <li key={label}>
                          <a href={value as string} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                            {label} ↗
                          </a>
                        </li>
                      ))}
                    {!author.social.website && !author.social.twitter && !author.social.instagram && !author.social.goodreads && (
                      <li className="text-muted-foreground">No links published yet.</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardContent>
                  <h2 className="text-sm font-semibold text-foreground">Author stats</h2>
                  <dl className="mt-2 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Published books</dt>
                      <dd className="text-foreground">{author.totalBooks}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Copies sold</dt>
                      <dd className="text-foreground">{author.totalSales.toLocaleString()}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Average rating</dt>
                      <dd className="text-foreground">{author.rating.toFixed(1)} / 5</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Followers</dt>
                      <dd className="text-foreground">{author.followers.toLocaleString()}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {tab === 'reviews' && (
          <>
            {!reviews.length ? (
              <EmptyState icon="★" title="No ratings yet" description="Reviews appear here once readers rate a book." />
            ) : (
              <ul className="space-y-3">
                {reviews.map((entry) => (
                  <li key={entry.book.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                    <Link to={`/marketplace/${entry.book.id}`} className="flex min-w-0 items-center gap-3">
                      <img src={entry.book.cover.imageUrl} alt="" className="h-14 w-10 rounded object-cover" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">{entry.book.title}</span>
                        <span className="block text-xs text-muted-foreground">{entry.count} reviews</span>
                      </span>
                    </Link>
                    <div className="flex items-center gap-3">
                      <Rating value={entry.rating} count={entry.count} />
                      <Button size="sm" variant="outline" onClick={() => navigate(`/marketplace/${entry.book.id}`)}>
                        Read reviews
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section tone="muted">
        <SectionHeading title={`More from ${author.name.split(' ')[0]}`} description="New releases, free reads and reader favourites." align="left" />
        <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {authored.slice(0, 4).map((book) => (
            <BookCard key={book.id} book={book} showAuthor={false} />
          ))}
          {!authored.length && <p className="text-sm text-muted-foreground">Nothing to recommend yet.</p>}
        </div>
      </Section>

      {contactOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setContactOpen(false)} aria-hidden />
          <div role="dialog" aria-modal="true" aria-label={`Message ${author.name}`} className="relative w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-lift">
            <h2 className="text-base font-semibold text-foreground">Message {author.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Messages are delivered through the platform. Abusive messages can be reported.</p>
            <Textarea
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Say something specific about their work…"
              className="mt-3"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setContactOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={message.trim().length < 8}
                onClick={() => {
                  setMessage('');
                  setContactOpen(false);
                  info('Message sent', 'They will see it in their dashboard inbox.');
                }}
              >
                Send message
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
