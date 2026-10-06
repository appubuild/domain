import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBook, useReviews, useReviewSummary, useWishlist, useLibrary, useMarketplace } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { marketplaceService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { Seo } from '@/components/shared/Seo';
import { BookCard, BookCover } from '@/components/shared/BookCard';
import { Section, BreadcrumbBar } from '@/components/shared/sections';
import { Avatar, Badge, Button, Card, CardContent, Rating, Separator, Skeleton, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { formatCurrency, formatDate, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Review } from '@/types/domain';

export default function MarketplaceBookPage() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { success, error: errorToast, info } = useToast();
  const confirm = useConfirm();

  const { data: book, isLoading, isError, refetch } = useBook(bookId);
  const { data: reviews } = useReviews(bookId);
  const { data: summary } = useReviewSummary(bookId);
  const { data: wishlist } = useWishlist(user?.id);
  const { data: library } = useLibrary(user?.id);
  const { data: related } = useMarketplace({
    query: '',
    categoryIds: book?.categoryIds ?? [],
    priceFilter: 'all',
    minRating: 0,
    sort: 'rating',
    kind: 'all',
  });

  const [checkoutOpen, setCheckoutOpen] = React.useState(false);
  const [method, setMethod] = React.useState<'card' | 'paypal' | 'apple-pay' | 'credits'>('card');
  const [busy, setBusy] = React.useState(false);
  const [receipt, setReceipt] = React.useState<{ number: string; total: number; authorEarnings: number; method: string } | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewDraft, setReviewDraft] = React.useState({ rating: 5, title: '', body: '' });
  const [tab, setTab] = React.useState<'overview' | 'contents' | 'reviews' | 'details'>('overview');

  const inWishlist = Boolean((wishlist ?? []).some((entry) => entry.item.bookId === bookId));
  const libraryItem = (library ?? []).find((entry) => entry.item.bookId === bookId);
  const owns = Boolean(libraryItem) || book?.ownerId === user?.id;
  const ownReview = (reviews ?? []).find((review) => review.userId === user?.id);
  const price = book ? (book.marketplace.discountPercent ? book.marketplace.price * (1 - book.marketplace.discountPercent / 100) : book.marketplace.price) : 0;

  React.useEffect(() => {
    if (bookId) marketplaceService.trackView(bookId, user?.id, 'marketplace');
  }, [bookId, user?.id]);

  React.useEffect(() => {
    if (ownReview) {
      setReviewDraft({ rating: ownReview.rating, title: ownReview.title, body: ownReview.body });
    }
  }, [ownReview]);

  if (isLoading) {
    return (
      <div className="container grid gap-8 py-10 lg:grid-cols-[300px_1fr]">
        <Skeleton className="h-[420px] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !book) {
    return (
      <div className="container py-16">
        <ErrorState title="That book could not be found" description="It may have been unpublished or removed." onRetry={() => refetch()} />
      </div>
    );
  }

  const isAuthor = book.ownerId === user?.id;
  const publishedReviews = (reviews ?? []).filter((review) => review.status === 'published');

  const toggleWishlist = async () => {
    if (!user) return navigate(`/login?next=/marketplace/${book.id}`);
    const result = await marketplaceService.toggleWishlist(user.id, book.id);
    success(result.added ? 'Added to wishlist' : 'Removed from wishlist', book.title);
  };

  const buy = async () => {
    if (!user) {
      navigate(`/login?next=/marketplace/${book.id}`);
      return;
    }
    if (isAuthor) {
      info('This is your own book', 'Open it in the editor instead.');
      return;
    }
    setBusy(true);
    try {
      const result = await marketplaceService.purchase(book.id, user.id, method);
      setReceipt(result.receipt);
      success('Purchase complete', `${book.title} is in your library.`);
      setCheckoutOpen(false);
    } catch (caught) {
      errorToast('Checkout could not complete', caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await marketplaceService.addReview(book.id, user.id, reviewDraft);
      success(ownReview ? 'Review updated' : 'Review published', 'Thanks for helping other readers.');
      setReviewOpen(false);
    } catch (caught) {
      errorToast('Review could not be saved', caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const deleteReview = async (review: Review) => {
    const ok = await confirm({ title: 'Delete your review?', description: 'This cannot be undone.', destructive: true, confirmLabel: 'Delete review' });
    if (!ok) return;
    marketplaceService.removeReview(review.id);
    success('Review deleted');
  };

  return (
    <>
      <Seo
        title={`${book.title} — ${book.authorName}`}
        description={book.shortDescription || book.description.slice(0, 150)}
        canonical={`/marketplace/${book.id}`}
        type="book"
        image={book.cover.imageUrl}
        keywords={book.tags}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: book.title,
          author: { '@type': 'Person', name: book.authorName },
          numberOfPages: book.pageCount,
          inLanguage: book.language,
          offers: { '@type': 'Offer', price: price.toFixed(2), priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
          aggregateRating:
            book.marketplace.reviewCount > 0
              ? { '@type': 'AggregateRating', ratingValue: book.marketplace.rating.toFixed(1), reviewCount: book.marketplace.reviewCount }
              : undefined,
        }}
      />
      <div className="container">
        <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Marketplace', href: '/marketplace' }, { label: book.title }]} />
      </div>

      <div className="container grid gap-8 pb-6 lg:grid-cols-[300px_1fr]">
        <div className="space-y-4">
          <BookCover book={book} className="mx-auto max-w-[280px]" />
          <div className="space-y-2">
            {owns ? (
              <Button className="w-full" size="lg" onClick={() => navigate(`/read/${book.id}`)}>
                {libraryItem ? `Continue reading${libraryItem.item.progress ? ` — ${libraryItem.item.progress}%` : ''}` : 'Read now'}
              </Button>
            ) : (
              <Button className="w-full" size="lg" loading={busy && checkoutOpen} onClick={() => setCheckoutOpen(true)}>
                {price === 0 ? 'Get it free' : `Buy for ${formatCurrency(price)}`}
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => navigate(`/read/${book.id}?preview=1`)}>
              Read free preview
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={toggleWishlist}>
                {inWishlist ? '♥ In wishlist' : '♡ Add to wishlist'}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/marketplace/${book.id}`);
                  success('Link copied', 'Share it anywhere.');
                }}
              >
                Share
              </Button>
            </div>
            {isAuthor && (
              <Button variant="ghost" className="w-full" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>
                Open in editor
              </Button>
            )}
          </div>
          <Card>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Format</span>
                <span className="text-foreground">Ebook · EPUB 3 · PDF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pages</span>
                <span className="text-foreground">{book.pageCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Words</span>
                <span className="text-foreground">{book.wordCount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Language</span>
                <span className="text-foreground">{book.language}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Published</span>
                <span className="text-foreground">{book.publishedAt ? formatDate(book.publishedAt) : 'Not published'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sales</span>
                <span className="text-foreground">{book.marketplace.sales.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Link to={`/authors/${book.ownerId}`} className="flex items-center gap-3">
                <Avatar name={book.authorName} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{book.authorName}</p>
                  <p className="text-xs text-muted-foreground">View author profile →</p>
                </div>
              </Link>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{book.kind.replace('-', ' ')}</Badge>
            {book.marketplace.staffPick && <Badge variant="accent">Staff pick</Badge>}
            {book.marketplace.discountPercent > 0 && <Badge variant="danger">−{book.marketplace.discountPercent}% this week</Badge>}
            {owns && <Badge variant="success">In your library</Badge>}
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{book.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            by{' '}
            <Link to={`/authors/${book.ownerId}`} className="text-foreground hover:text-primary">
              {book.authorName}
            </Link>
            {book.subtitle && ` · ${book.subtitle}`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Rating value={book.marketplace.rating} count={book.marketplace.reviewCount} />
            <span className="text-sm text-muted-foreground">{book.marketplace.sales.toLocaleString()} copies sold</span>
            <span className="text-sm text-muted-foreground">{book.marketplace.views.toLocaleString()} views</span>
          </div>

          <div className="mt-4 flex items-end gap-3">
            <span className="font-display text-3xl font-bold text-foreground">
              {price === 0 ? <span className="text-success">Free</span> : formatCurrency(price)}
            </span>
            {book.marketplace.discountPercent > 0 && <span className="text-sm text-muted-foreground line-through">{formatCurrency(book.marketplace.price)}</span>}
          </div>

          <div className="mt-6 flex gap-1 border-b border-border" role="tablist" aria-label="Book details">
            {(['overview', 'contents', 'reviews', 'details'] as const).map((entry) => (
              <button
                key={entry}
                role="tab"
                aria-selected={tab === entry}
                type="button"
                onClick={() => setTab(entry)}
                className={cn(
                  'border-b-2 px-3.5 py-2.5 text-sm font-medium capitalize transition-colors',
                  tab === entry ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {entry === 'reviews' ? `Reviews (${publishedReviews.length})` : entry}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {tab === 'overview' && (
              <div className="space-y-5">
                <div className="prose-scriptora space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <p>{book.description}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-sm font-semibold text-foreground">About the author</p>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {book.authorName} publishes with Scriptora and keeps the majority of every sale. Follow the profile to hear about the next release.
                  </p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate(`/authors/${book.ownerId}`)}>
                    Visit author page
                  </Button>
                </div>
                {summary && (
                  <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                    <div className="rounded-xl border border-border bg-card p-4 text-center">
                      <p className="font-display text-4xl font-bold text-foreground">{summary.rating.toFixed(1)}</p>
                      <div className="mt-1 flex justify-center">
                        <Rating value={summary.rating} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{summary.count} ratings</p>
                    </div>
                    <div className="space-y-2">
                      {[...summary.breakdown].reverse().map((row) => (
                        <div key={row.star} className="flex items-center gap-3 text-xs">
                          <span className="w-8 text-muted-foreground">{row.star}★</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
                          </div>
                          <span className="w-8 text-right text-muted-foreground">{row.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'contents' && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Contents generated from the author's book structure.</p>
                <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {book.sections.map((section, index) => (
                    <li key={section.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="text-sm text-foreground">
                        {index + 1}. {section.title}
                      </span>
                      <span className="text-xs capitalize text-muted-foreground">{section.kind.replace('-', ' ')}</span>
                    </li>
                  ))}
                </ol>
                <p className="text-xs text-muted-foreground">
                  The full text unlocks after purchase, or read the free preview in the built-in reader.
                </p>
              </div>
            )}

            {tab === 'reviews' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {publishedReviews.length} published reviews · sorted by most helpful
                  </p>
                  <Button
                    size="sm"
                    variant={ownReview ? 'outline' : 'default'}
                    onClick={() => {
                      if (!isAuthenticated) navigate(`/login?next=/marketplace/${book.id}`);
                      else setReviewOpen(true);
                    }}
                  >
                    {ownReview ? 'Edit your review' : 'Write a review'}
                  </Button>
                </div>
                {!publishedReviews.length ? (
                  <EmptyState icon="★" title="No reviews yet" description="Be the first to review this book after reading it." />
                ) : (
                  <ul className="space-y-4">
                    {[...publishedReviews]
                      .sort((a, b) => b.helpful - a.helpful)
                      .map((review) => (
                        <li key={review.id} className="rounded-xl border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={review.userName} src={review.userAvatar} size={36} />
                              <div>
                                <p className="text-sm font-medium text-foreground">{review.userName}</p>
                                <p className="text-2xs text-muted-foreground">
                                  {timeAgo(review.createdAt)}
                                  {review.verifiedPurchase && ' · verified purchase'}
                                </p>
                              </div>
                            </div>
                            <Rating value={review.rating} />
                          </div>
                          <p className="mt-3 text-sm font-semibold text-foreground">{review.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{review.body}</p>
                          <div className="mt-3 flex items-center gap-3 text-xs">
                            <button
                              type="button"
                              className="text-muted-foreground transition-colors hover:text-foreground"
                              onClick={() => {
                                marketplaceService.markHelpful(review.id);
                                info('Marked as helpful');
                              }}
                            >
                              Helpful ({review.helpful})
                            </button>
                            {review.userId === user?.id && (
                              <>
                                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setReviewOpen(true)}>
                                  Edit
                                </button>
                                <button type="button" className="text-destructive hover:underline" onClick={() => deleteReview(review)}>
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            {tab === 'details' && (
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Trim size', book.trimSize.label],
                  ['Orientation', book.orientation],
                  ['Gutter', `${book.gutter}in`],
                  ['Bleed', `${book.bleed}in`],
                  ['Paper stock', book.paperStock],
                  ['Heading font', book.fonts.heading],
                  ['Body font', book.fonts.body],
                  ['Categories', (book.categoryIds.length ? book.categoryIds : ['—']).join(', ')],
                  ['Tags', book.tags.join(', ') || '—'],
                  ['ISBN', book.metadata.isbn || 'Not assigned'],
                  ['Publisher', book.metadata.publisher || 'Independent'],
                  ['Edition', book.metadata.edition || 'First edition'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-card px-3.5 py-2.5">
                    <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="text-sm capitalize text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </div>

      {related && related.filter((entry) => entry.id !== book.id).length > 0 && (
        <Section tone="muted">
          <h2 className="font-display text-xl font-bold text-foreground">Readers also bought</h2>
          <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
            {related
              .filter((entry) => entry.id !== book.id)
              .slice(0, 4)
              .map((entry) => (
                <BookCard key={entry.id} book={entry} />
              ))}
          </div>
        </Section>
      )}

      <Modal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        title={price === 0 ? 'Get this book free' : `Checkout — ${formatCurrency(price)}`}
        description={`${book.title} by ${book.authorName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckoutOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={buy}>
              {price === 0 ? 'Add to library' : `Pay ${formatCurrency(price)}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {(['card', 'paypal', 'apple-pay', 'credits'] as const).map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm',
                  method === option ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <input type="radio" name="payment-method" checked={method === option} onChange={() => setMethod(option)} className="accent-primary" />
                <span className="flex-1 text-foreground">
                  {option === 'card'
                    ? 'Card ending 4242'
                    : option === 'paypal'
                      ? 'PayPal balance'
                      : option === 'apple-pay'
                        ? 'Apple Pay'
                        : 'Scriptora credits'}
                </span>
                {option === 'card' && <Badge variant="secondary">Visa</Badge>}
              </label>
            ))}
          </div>
          <Separator />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-foreground">{formatCurrency(price)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Platform fee</dt>
              <dd className="text-foreground">{formatCurrency(price * book.marketplace.commissionRate)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Author receives</dt>
              <dd className="text-success">{formatCurrency(price * (1 - book.marketplace.commissionRate))}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <dt className="text-foreground">Total due today</dt>
              <dd className="text-foreground">{formatCurrency(price)}</dd>
            </div>
          </dl>
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            This is a simulated checkout. No card is stored or charged — orders, receipts and author earnings are real records in the mock database.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(receipt)}
        onOpenChange={(open) => !open && setReceipt(null)}
        title="Purchase complete"
        description="Your receipt is available in the library at any time."
        footer={
          <>
            <Button variant="outline" onClick={() => setReceipt(null)}>
              Close
            </Button>
            <Button onClick={() => navigate(`/read/${book.id}`)}>Start reading</Button>
          </>
        }
      >
        {receipt && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="font-mono text-sm text-foreground">{receipt.number}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date().toLocaleString()}</p>
            </div>
            <dl className="space-y-2">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total paid</dt>
                <dd className="text-foreground">{formatCurrency(receipt.total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Payment method</dt>
                <dd className="text-foreground">{receipt.method}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Author earnings</dt>
                <dd className="text-success">{formatCurrency(receipt.authorEarnings)}</dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>

      <Modal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={ownReview ? 'Edit your review' : 'Write a review'}
        description="Reviews are public. You can edit or delete yours at any time."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!reviewDraft.title.trim() || !reviewDraft.body.trim()} onClick={submitReview}>
              {ownReview ? 'Save changes' : 'Publish review'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Rating</span>
            <div className="mt-1.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  onClick={() => setReviewDraft((current) => ({ ...current, rating: star }))}
                  className={cn('text-2xl leading-none transition-colors', star <= reviewDraft.rating ? 'text-warning' : 'text-muted')}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="review-title" className="text-xs font-medium text-muted-foreground">
              Headline
            </label>
            <input
              id="review-title"
              value={reviewDraft.title}
              onChange={(event) => setReviewDraft((current) => ({ ...current, title: event.target.value }))}
              maxLength={80}
              className="mt-1 flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              placeholder="Sum up your reading experience"
            />
          </div>
          <div>
            <label htmlFor="review-body" className="text-xs font-medium text-muted-foreground">
              Review
            </label>
            <Textarea
              id="review-body"
              rows={5}
              maxLength={1200}
              value={reviewDraft.body}
              onChange={(event) => setReviewDraft((current) => ({ ...current, body: event.target.value }))}
              placeholder="What worked, what did not, and who should read it."
              className="mt-1"
            />
            <p className="mt-1 text-2xs text-muted-foreground">{reviewDraft.body.length}/1200 characters</p>
          </div>
        </div>
      </Modal>
    </>
  );
}
