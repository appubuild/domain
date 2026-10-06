import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, Edit3, Flag, Heart, MessageSquare, Search, Star, ThumbsUp, Trash2, TrendingUp,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Rating, Separator } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { EmptyState, Pagination, StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useBooks, useLibrary, useReviewSummary } from '@/hooks/queries';
import { marketplaceService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatNumber, timeAgo } from '@/lib/format';
import { cn, percent } from '@/lib/utils';
import type { Book, Review } from '@/types/domain';

export default function ReviewsDashboardPage() {
  const { user } = useAuth();
  const { success, error, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });
  const { data: library } = useLibrary(user?.id);
  const [tab, setTab] = React.useState('received');
  const [query, setQuery] = React.useState('');
  const [ratingFilter, setRatingFilter] = React.useState<'all' | '5' | '4' | '3' | 'low'>('all');
  const [bookFilter, setBookFilter] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const perPage = 10;
  const [compose, setCompose] = React.useState<{ book: Book; review?: Review } | null>(null);
  const [draft, setDraft] = React.useState({ rating: 5, title: '', body: '' });
  const [reporting, setReporting] = React.useState<Review | null>(null);
  const [reportReason, setReportReason] = React.useState('Spam or promotional content');
  const [reportDetail, setReportDetail] = React.useState('');

  const received = React.useMemo<Review[]>(() => {
    const list: Review[] = [];
    (books ?? []).forEach((book) => { list.push(...marketplaceService.reviews(book.id)); });
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [books]);

  const written = React.useMemo<Review[]>(() => {
    const owned = new Set((library ?? []).map((entry) => entry.book?.id).filter(Boolean) as string[]);
    const list: Review[] = [];
    owned.forEach((bookId) => {
      const review = marketplaceService.reviews(bookId).find((entry) => entry.userId === user?.id);
      if (review) list.push(review);
    });
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [library, user]);

  const active = tab === 'received' ? received : written;

  const filtered = React.useMemo(() => {
    return active.filter((review) => {
      if (bookFilter !== 'all' && review.bookId !== bookFilter) return false;
      if (ratingFilter === 'low' && review.rating > 2) return false;
      if (ratingFilter !== 'all' && ratingFilter !== 'low' && review.rating !== Number(ratingFilter)) return false;
      if (query && !`${review.title} ${review.body} ${review.userName}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [active, bookFilter, ratingFilter, query]);

  const stats = React.useMemo(() => {
    const all = received;
    const avg = all.length ? all.reduce((total, review) => total + review.rating, 0) / all.length : 0;
    const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: all.filter((review) => review.rating === rating).length }));
    return {
      total: all.length,
      avg,
      distribution,
      fiveStar: all.filter((review) => review.rating === 5).length,
      pending: all.filter((review) => review.status === 'pending').length,
      flagged: all.filter((review) => review.flagged).length,
      helpful: all.reduce((total, review) => total + review.helpful, 0),
    };
  }, [received]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const visible = filtered.slice((page - 1) * perPage, page * perPage);
  const { data: summarySample } = useReviewSummary((books ?? [])[0]?.id);

  const submitReview = async () => {
    if (!compose || !user) return;
    try {
      if (compose.review) {
        marketplaceService.updateReview(compose.review.id, { rating: draft.rating, title: draft.title, body: draft.body });
        success('Review updated');
      } else {
        await marketplaceService.addReview(compose.book.id, user.id, { rating: draft.rating, title: draft.title, body: draft.body });
        success('Review published', 'Thank you — reviews help other readers decide.');
      }
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['books'] });
      setCompose(null);
    } catch (e) {
      error('Could not save review', (e as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Reviews</h1>
          <p className="text-sm text-muted-foreground">Feedback on your books, and the reviews you have written for others.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/marketplace')}>
            <Search className="h-4 w-4" /> Find a book to review
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reviews received" value={formatNumber(stats.total)} hint={stats.pending ? `${stats.pending} awaiting moderation` : 'All published'} icon={<MessageSquare className="h-4 w-4" />} />
        <StatCard label="Average rating" value={stats.avg ? stats.avg.toFixed(2) : '—'} hint={`${stats.fiveStar} five-star reviews`} icon={<Star className="h-4 w-4" />} tone="success" />
        <StatCard label="Helpful votes" value={formatNumber(stats.helpful)} hint="Readers finding reviews useful" icon={<ThumbsUp className="h-4 w-4" />} />
        <StatCard label="Flagged" value={formatNumber(stats.flagged)} hint="Reported to moderators" icon={<Flag className="h-4 w-4" />} tone={stats.flagged ? 'warning' : 'default'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Feedback</CardTitle>
              <CardDescription>{filtered.length} of {active.length} reviews</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search reviews" className="h-9 w-[190px] pl-8" aria-label="Search reviews" />
              </div>
              <select value={ratingFilter} onChange={(event) => { setRatingFilter(event.target.value as typeof ratingFilter); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by rating">
                <option value="all">All ratings</option>
                <option value="5">5 stars</option>
                <option value="4">4 stars</option>
                <option value="3">3 stars</option>
                <option value="low">1–2 stars</option>
              </select>
              <select value={bookFilter} onChange={(event) => { setBookFilter(event.target.value); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by book">
                <option value="all">All books</option>
                {(books ?? []).map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={tab}
              onValueChange={(value) => { setTab(value); setPage(1); }}
              tabs={[
                { value: 'received', label: 'On my books', count: received.length },
                { value: 'written', label: 'Written by me', count: written.length },
              ]}
            />

            {visible.length === 0 && (
              <EmptyState
                icon={<MessageSquare className="h-5 w-5" />}
                title={tab === 'received' ? 'No reviews yet' : 'You have not reviewed a book yet'}
                description={tab === 'received' ? 'Share your book widely — reviews arrive once readers finish it.' : 'Buy or borrow a book, then share what you thought. Reviews appear on the marketplace listing.'}
                actions={tab === 'written' ? <Button size="sm" onClick={() => navigate('/marketplace')}>Browse the marketplace</Button> : undefined}
              />
            )}

            {visible.map((review) => (
              <div key={review.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">
                      {review.userAvatar ? <img src={review.userAvatar} alt="" className="h-full w-full object-cover" /> : review.userName.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{review.userName}</p>
                        {review.verifiedPurchase && <Badge variant="success" className="gap-1 text-2xs"><BadgeCheck className="h-2.5 w-2.5" /> Verified purchase</Badge>}
                        {review.status === 'pending' && <Badge variant="warning" className="text-2xs">Pending moderation</Badge>}
                        {review.status === 'hidden' && <Badge variant="secondary" className="text-2xs">Hidden</Badge>}
                        {review.flagged && <Badge variant="danger" className="text-2xs">Flagged</Badge>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Rating value={review.rating} size={14} />
                        <span className="text-xs text-muted-foreground">{timeAgo(review.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="xs" onClick={() => { marketplaceService.markHelpful(review.id); qc.invalidateQueries({ queryKey: ['reviews'] }); info('Thanks — marked helpful'); }}>
                      <Heart className="h-3 w-3" /> {review.helpful}
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setReporting(review)}>
                      <Flag className="h-3 w-3" /> Report
                    </Button>
                    {(books ?? []).some((book) => book.id === review.bookId) && (
                      <Button variant="ghost" size="xs" onClick={() => navigate(`/dashboard/books/${review.bookId}`)}>View book</Button>
                    )}
                  </div>
                </div>
                {review.title && <p className="mt-3 text-sm font-medium">{review.title}</p>}
                <p className="mt-1 text-sm text-muted-foreground">{review.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(books ?? []).find((book) => book.id === review.bookId)?.title ?? 'Marketplace title'}
                </p>
                {review.updatedAt && <p className="text-xs text-muted-foreground">Edited {timeAgo(review.updatedAt)}</p>}
                {review.userId === user?.id && (
                  <div className="mt-3 flex gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        const book = (books ?? []).find((entry) => entry.id === review.bookId) ?? library?.find((entry) => entry.book?.id === review.bookId)?.book;
                        if (!book) { info('Open the book listing to edit this review.'); return; }
                        setCompose({ book, review });
                        setDraft({ rating: review.rating, title: review.title, body: review.body });
                      }}
                    >
                      <Edit3 className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={async () => {
                        const ok = await confirm({ title: 'Delete your review?', description: 'Your rating will be removed from the book’s average.', destructive: true, confirmLabel: 'Delete review' });
                        if (!ok) return;
                        marketplaceService.removeReview(review.id);
                        qc.invalidateQueries({ queryKey: ['reviews'] });
                        qc.invalidateQueries({ queryKey: ['books'] });
                        success('Review deleted');
                      }}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {filtered.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rating breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.distribution.map((entry) => (
                <div key={entry.rating} className="flex items-center gap-2">
                  <span className="w-8 text-xs text-muted-foreground">{entry.rating}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${percent(entry.count, Math.max(1, stats.total))}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{entry.count}</span>
                </div>
              ))}
              <Separator />
              <p className="text-xs text-muted-foreground">
                {formatNumber(stats.total)} reviews · average {stats.avg ? stats.avg.toFixed(2) : '—'} · {percent(stats.fiveStar, Math.max(1, stats.total)).toFixed(0)}% five-star
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Books you can review</CardTitle>
              <CardDescription>From your library</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(library ?? []).filter((entry) => entry.book).slice(0, 6).map((entry) => {
                const book = entry.book as Book;
                const existing = written.find((review) => review.bookId === book.id);
                return (
                  <div key={entry.item.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{book.title}</p>
                      <p className="text-xs text-muted-foreground">{existing ? `You rated ${existing.rating}★` : 'Not reviewed yet'}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        setCompose({ book, review: existing });
                        setDraft(existing ? { rating: existing.rating, title: existing.title, body: existing.body } : { rating: 5, title: '', body: '' });
                      }}
                    >
                      {existing ? 'Edit' : 'Review'}
                    </Button>
                  </div>
                );
              })}
              {(library ?? []).length === 0 && <p className="text-sm text-muted-foreground">Buy or borrow a book to leave a review.</p>}
            </CardContent>
          </Card>

          {summarySample && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Marketplace context</CardTitle>
                <CardDescription>How your books compare to the catalogue average</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Your average</span><span className="font-medium">{stats.avg ? stats.avg.toFixed(2) : '—'}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Catalogue average</span><span className="font-medium">{summarySample.rating.toFixed(2)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Your review count</span><span className="font-medium">{formatNumber(stats.total)}</span></div>
                <div className="flex items-center gap-1.5 pt-1 text-muted-foreground">
                  <TrendingUp className={cn('h-3.5 w-3.5', stats.avg >= summarySample.rating ? 'text-emerald-500' : 'text-amber-500')} />
                  {stats.avg >= summarySample.rating ? 'Above catalogue average' : 'Below catalogue average — consider asking early readers for honest reviews.'}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(compose)}
        onOpenChange={(open) => !open && setCompose(null)}
        title={compose?.review ? 'Edit your review' : `Review “${compose?.book.title ?? ''}”`}
        description="Your review is public on the marketplace listing and helps other readers."
        footer={
          <>
            <Button variant="outline" onClick={() => setCompose(null)}>Cancel</Button>
            <Button onClick={submitReview} disabled={draft.body.trim().length < 12}>{compose?.review ? 'Save changes' : 'Publish review'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Rating</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setDraft((current) => ({ ...current, rating: value }))} aria-label={`${value} star${value === 1 ? '' : 's'}`}>
                  <Star className={cn('h-6 w-6', value <= draft.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="review-title">Headline</label>
            <Input id="review-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Sum it up in a few words" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="review-body">Your review</label>
            <textarea
              id="review-body"
              value={draft.body}
              onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
              rows={5}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="What worked, what did not, and who should read it?"
            />
            <p className="text-xs text-muted-foreground">{draft.body.trim().length} characters · minimum 12</p>
          </div>
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mr-1 inline h-3 w-3" /> Reviews are moderated for spam and abuse. Honest critical reviews are welcome.
          </p>
        </div>
      </Modal>

      <Modal
        open={Boolean(reporting)}
        onOpenChange={(open) => !open && setReporting(null)}
        title="Report this review"
        description="Reports go to Scriptora moderators. Abusive or spammy reviews are hidden while under review."
        footer={
          <>
            <Button variant="outline" onClick={() => setReporting(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!reporting || !user) return;
                try {
                  await marketplaceService.reportReview(reporting.id, user.id, reportReason, reportDetail);
                  qc.invalidateQueries({ queryKey: ['reviews'] });
                  success('Report submitted', 'A moderator will review it shortly.');
                  setReporting(null);
                  setReportDetail('');
                } catch (e) {
                  error('Could not submit report', (e as Error).message);
                }
              }}
            >
              <Flag className="h-4 w-4" /> Submit report
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="report-reason">Reason</label>
            <select id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              {['Spam or promotional content', 'Harassment or hate speech', 'Spoilers without warning', 'Off-topic or not a review', 'Plagiarised content', 'Other'].map((reason) => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="report-detail">Details (optional)</label>
            <textarea id="report-detail" value={reportDetail} onChange={(event) => setReportDetail(event.target.value)} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          {reporting && <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">Reporting review by {reporting.userName} · {reporting.rating}★</p>}
        </div>
      </Modal>
    </div>
  );
}
