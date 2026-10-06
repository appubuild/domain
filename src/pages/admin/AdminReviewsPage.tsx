import * as React from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Flag, MessageSquare, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, Textarea } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { BarsChart } from '@/components/ui/charts';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useModerationQueue, keys } from '@/hooks/queries';
import { adminService, marketplaceService } from '@/services';
import { formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterSelect, StatusPill, Toolbar } from './shared';
import type { Review } from '@/types/domain';
import { Rating } from '@/components/ui/primitives';

export default function AdminReviewsPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data: queue, isLoading, refetch } = useModerationQueue();
  const [status, setStatus] = React.useState('all');
  const [rating, setRating] = React.useState('all');
  const [sort, setSort] = React.useState<'recent' | 'rating-low' | 'rating-high' | 'helpful'>('recent');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [detail, setDetail] = React.useState<Review | null>(null);
  const [note, setNote] = React.useState('');

  const allReviews: Review[] = React.useMemo(() => marketplaceService.allReviews(), [queue]);

  const moderate = useAdminAction(
    ({ reviewId, action, note: moderationNote }: { reviewId: string; action: 'approve' | 'hide' | 'delete' | 'flag' | 'restore'; note?: string }) => adminService.moderateReview(reviewId, action, actor, moderationNote),
    { success: 'Review updated', detail: 'Recorded in the audit log.', invalidate: [keys.moderation] },
  );

  const rows = React.useMemo(() => {
    let list = allReviews.slice();
    if (status !== 'all') list = list.filter((review) => review.status === status);
    if (rating !== 'all') list = list.filter((review) => review.rating === Number(rating));
    if (sort === 'rating-low') list.sort((a, b) => a.rating - b.rating);
    else if (sort === 'rating-high') list.sort((a, b) => b.rating - a.rating);
    else if (sort === 'helpful') list.sort((a, b) => b.helpful - a.helpful);
    else list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return list;
  }, [allReviews, rating, sort, status]);

  const distribution = [1, 2, 3, 4, 5].map((value) => ({ label: `${value}★`, count: allReviews.filter((review) => review.rating === value).length }));

  const columns: Column<Review>[] = [
    {
      key: 'review',
      header: 'Review',
      render: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-xs font-medium">
            {row.title || 'Untitled'}
            {row.flagged && <Badge variant="danger" className="text-2xs">flagged</Badge>}
            {row.verifiedPurchase && <Badge variant="success" className="text-2xs">verified</Badge>}
          </p>
          <p className="line-clamp-2 text-2xs text-muted-foreground">{row.body}</p>
        </div>
      ),
    },
    { key: 'rating', header: 'Rating', render: (row) => <Rating value={row.rating} size={12} /> },
    { key: 'user', header: 'Reviewer', render: (row) => <Link to={`/admin/users/${row.userId}`} className="text-2xs hover:underline">{row.userName}</Link> },
    { key: 'book', header: 'Book', render: (row) => <Link to={`/dashboard/books/${row.bookId}`} className="text-2xs hover:underline">Open book</Link> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'helpful', header: 'Helpful', align: 'right', sortable: true, render: (row) => formatNumber(row.helpful) },
    { key: 'createdAt', header: 'Posted', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => { setDetail(row); setNote(row.adminNote ?? ''); }}>Review</Button>
          {row.status === 'pending' && <Button size="xs" variant="outline" onClick={() => moderate.mutate({ reviewId: row.id, action: 'approve' })}><Check className="h-3 w-3" /></Button>}
          {row.status === 'published' && <Button size="xs" variant="ghost" onClick={() => moderate.mutate({ reviewId: row.id, action: 'hide' })}><EyeOff className="h-3 w-3" /></Button>}
          {row.status === 'hidden' && <Button size="xs" variant="ghost" onClick={() => moderate.mutate({ reviewId: row.id, action: 'restore' })}>Restore</Button>}
          <Button size="xs" variant="ghost" onClick={() => moderate.mutate({ reviewId: row.id, action: 'flag' })}><Flag className="h-3 w-3" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Reviews" description="Moderate reader reviews, keep ratings trustworthy and respond to flagged content." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total reviews" value={formatNumber(allReviews.length)} icon={<MessageSquare className="h-4 w-4" />} />
        <StatCard label="Pending" value={formatNumber(allReviews.filter((review) => review.status === 'pending').length)} change="awaiting approval" />
        <StatCard label="Hidden" value={formatNumber(allReviews.filter((review) => review.status === 'hidden').length)} icon={<EyeOff className="h-4 w-4" />} />
        <StatCard label="Average rating" value={(allReviews.reduce((total, review) => total + review.rating, 0) / Math.max(1, allReviews.length)).toFixed(2)} icon={<Star className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rating distribution</CardTitle></CardHeader>
          <CardContent><BarsChart data={distribution} dataKey="count" currency={false} height={200} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Moderation queue</CardTitle>
            <CardDescription className="text-xs">{queue?.length ?? 0} reviews awaiting a decision.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(queue ?? []).slice(0, 4).map((review) => (
              <div key={review.id} className="rounded border p-2 text-xs">
                <p className="flex items-center gap-1.5 truncate font-medium"><Rating value={review.rating} size={11} /> {review.title}</p>
                <p className="line-clamp-2 text-2xs text-muted-foreground">{review.body}</p>
                <div className="mt-1 flex gap-1">
                  <Button size="xs" variant="outline" onClick={() => moderate.mutate({ reviewId: review.id, action: 'approve' })}>Approve</Button>
                  <Button size="xs" variant="ghost" onClick={() => moderate.mutate({ reviewId: review.id, action: 'hide' })}>Hide</Button>
                </div>
              </div>
            ))}
            {(queue ?? []).length === 0 && <p className="text-xs text-muted-foreground">Queue is clear.</p>}
          </CardContent>
        </Card>
      </div>

      <Toolbar className="mt-4">
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'published', label: 'Published' }, { value: 'pending', label: 'Pending' }, { value: 'hidden', label: 'Hidden' }]} />
        <FilterSelect label="Rating" value={rating} onChange={setRating} options={[{ value: 'all', label: 'All ratings' }, ...[5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: `${value} stars` }))]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'recent', label: 'Newest' }, { value: 'rating-low', label: 'Lowest rated' }, { value: 'rating-high', label: 'Highest rated' }, { value: 'helpful', label: 'Most helpful' }]} />
        {selected.length > 0 && <Button size="sm" variant="outline" onClick={async () => { for (const reviewId of selected) await adminService.moderateReview(reviewId, 'approve', actor); success(`${selected.length} reviews approved`); setSelected([]); void refetch(); }}>Approve selected ({selected.length})</Button>}
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            emptyState={<EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No reviews match" description="Adjust the filters to see more reader feedback." />}
          />
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => !next && setDetail(null)}
        title={detail?.title || 'Review'}
        description={detail ? `${detail.userName} · ${timeAgo(detail.createdAt)} · ${detail.verifiedPurchase ? 'verified purchase' : 'unverified'}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail && detail.status !== 'published' && <Button onClick={() => { moderate.mutate({ reviewId: detail.id, action: 'approve', note }); setDetail(null); }}>Approve</Button>}
            {detail && <Button variant="outline" onClick={() => { moderate.mutate({ reviewId: detail.id, action: 'hide', note }); setDetail(null); }}>Hide</Button>}
            {detail && <Button variant="destructive" onClick={async () => { const ok = await confirm({ title: 'Delete this review?', description: 'The rating is recalculated for the book.', destructive: true, confirmLabel: 'Delete' }); if (ok) { moderate.mutate({ reviewId: detail.id, action: 'delete', note }); setDetail(null); } }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
          </>
        }
      >
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Rating value={detail.rating} size={14} /><StatusPill value={detail.status} />{detail.flagged && <Badge variant="danger" className="text-2xs">flagged</Badge>}</div>
            <p className="whitespace-pre-line rounded-lg border p-3 text-sm">{detail.body}</p>
            <Separator />
            <div className="space-y-1.5">
              <label htmlFor="review-note" className="text-xs font-medium">Moderator note (internal)</label>
              <Textarea id="review-note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why was this action taken?" />
            </div>
            <p className="text-2xs text-muted-foreground">Helpful votes: {detail.helpful} · Book: {detail.bookId} · Reviewer: {detail.userName}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
