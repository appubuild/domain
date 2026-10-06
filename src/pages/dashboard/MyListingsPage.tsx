import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, BarChart3, Clock, Eye, Heart, Loader2, Pencil, Rocket, Search, ShoppingCart, Sparkles, Star, Store, Trash2, TrendingUp, XCircle,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator, Switch } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useBooks, useOrders } from '@/hooks/queries';
import { bookService, marketplaceService, publishingService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatCompactCurrency, formatCurrency, formatNumber, statusLabel, timeAgo } from '@/lib/format';
import { cn, percent } from '@/lib/utils';
import type { Book } from '@/types/domain';

type ListingRow = Book & { id: string };

export default function MyListingsPage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: books, isLoading } = useBooks({ ownerId: user?.id, status: 'all', sort: 'recent' });
  const { data: orders } = useOrders(user?.id);
  const [view, setView] = React.useState<'listed' | 'unlisted' | 'all'>('listed');
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<'sales' | 'views' | 'revenue' | 'rating' | 'recent'>('sales');
  const [editing, setEditing] = React.useState<Book | null>(null);
  const [draft, setDraft] = React.useState({ price: 0, discount: 0, listed: false, freePreviewPages: 3 });

  const rows = React.useMemo<ListingRow[]>(() => {
    const list = (books ?? []).filter((book) => {
      if (view === 'listed' && !book.marketplace.listed) return false;
      if (view === 'unlisted' && book.marketplace.listed) return false;
      if (query && !book.title.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      if (sort === 'sales') return b.marketplace.sales - a.marketplace.sales;
      if (sort === 'views') return b.marketplace.views - a.marketplace.views;
      if (sort === 'revenue') return (b.marketplace.sales * b.marketplace.price) - (a.marketplace.sales * a.marketplace.price);
      if (sort === 'rating') return b.marketplace.rating - a.marketplace.rating;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
    return sorted.map((book) => ({ ...book, id: book.id }));
  }, [books, view, query, sort]);

  const totals = React.useMemo(() => {
    const listed = (books ?? []).filter((book) => book.marketplace.listed);
    return {
      listed: listed.length,
      sales: listed.reduce((total, book) => total + book.marketplace.sales, 0),
      revenue: listed.reduce((total, book) => total + book.marketplace.sales * book.marketplace.price * 0.85, 0),
      views: listed.reduce((total, book) => total + book.marketplace.views, 0),
      favorites: listed.reduce((total, book) => total + book.marketplace.favorites, 0),
    };
  }, [books]);

  const mutate = useMutation({
    mutationFn: async (input: { bookId: string; patch: Partial<Book['marketplace']> }) => {
      const book = bookService.get(input.bookId);
      if (!book) throw new Error('Book not found.');
      return bookService.update(input.bookId, { marketplace: { ...book.marketplace, ...input.patch } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['marketplace'] });
      success('Listing updated');
    },
    onError: (e: Error) => error('Could not update listing', e.message),
  });

  const unpublish = useMutation({
    mutationFn: (bookId: string) => publishingService.unpublish(bookId),
    onSuccess: () => { qc.invalidateQueries(); success('Listing withdrawn'); },
    onError: (e: Error) => error('Could not unpublish', e.message),
  });

  const columns: Column<ListingRow>[] = [
    {
      key: 'book',
      header: 'Book',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
            {row.cover.imageUrl ? <img src={row.cover.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-brand-gradient" />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.title}</p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{statusLabel(row.status)}</span>
              · <span>{row.visibility}</span>
              {row.marketplace.featured && <Badge variant="accent" className="text-2xs">Featured</Badge>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: '130px',
      render: (row) => (
        <div>
          <p className="text-sm font-medium">{row.marketplace.price === 0 ? 'Free' : formatCurrency(row.marketplace.price)}</p>
          {row.marketplace.discountPercent > 0 && <p className="text-xs text-emerald-600 dark:text-emerald-400">{row.marketplace.discountPercent}% off</p>}
        </div>
      ),
    },
    { key: 'sales', header: 'Sales', align: 'right', sortable: true, render: (row) => formatNumber(row.marketplace.sales) },
    { key: 'views', header: 'Views', align: 'right', sortable: true, render: (row) => formatNumber(row.marketplace.views) },
    { key: 'conversion', header: 'Conv.', align: 'right', render: (row) => `${row.marketplace.conversionRate.toFixed(2)}%` },
    { key: 'favorites', header: 'Wishlist', align: 'right', render: (row) => formatNumber(row.marketplace.favorites) },
    {
      key: 'rating',
      header: 'Rating',
      align: 'right',
      render: (row) => row.marketplace.rating
        ? <span className="inline-flex items-center gap-1">{row.marketplace.rating.toFixed(1)} <Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span>
        : <span className="text-muted-foreground">—</span>,
    },
    { key: 'revenue', header: 'Net revenue', align: 'right', render: (row) => formatCompactCurrency(row.marketplace.sales * row.marketplace.price * 0.85) },
    {
      key: 'listed',
      header: 'Listed',
      width: '90px',
      render: (row) => (
        <Switch
          checked={row.marketplace.listed}
          onCheckedChange={(checked) => {
            if (checked && !entitlements.canSellBook()) {
              warning('Marketplace selling is a Pro feature', 'Upgrade to list books for sale.');
              return;
            }
            mutate.mutate({ bookId: row.id, patch: { listed: checked } });
          }}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '150px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => { setEditing(row); setDraft({ price: row.marketplace.price, discount: row.marketplace.discountPercent, listed: row.marketplace.listed, freePreviewPages: row.marketplace.freePreviewPages }); }}
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <Button variant="ghost" size="xs" onClick={() => navigate(`/read/${row.id}`)}><Eye className="h-3 w-3" /> Preview</Button>
        </div>
      ),
    },
  ];

  const submissions = user ? publishingService.submissionsForAuthor(user.id) : [];
  const pending = submissions.filter((entry) => ['submitted', 'in_review', 'preflight', 'ready'].includes(entry.status));

  if (isLoading) return <div className="space-y-4"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Marketplace listings</h1>
          <p className="text-sm text-muted-foreground">Everything you are selling: pricing, visibility, performance and moderation status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/marketplace')}>
            <Store className="h-4 w-4" /> Browse marketplace
          </Button>
          <Button size="sm" onClick={() => navigate('/dashboard/publishing')}>
            <Rocket className="h-4 w-4" /> List a book
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Listed titles" value={String(totals.listed)} hint={`of ${books?.length ?? 0} books`} icon={<Store className="h-4 w-4" />} />
        <StatCard label="Marketplace sales" value={formatNumber(totals.sales)} hint={`${formatNumber(orders?.length ?? 0)} orders across all channels`} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Net revenue" value={formatCompactCurrency(totals.revenue)} hint="After 15% platform fee" icon={<TrendingUp className="h-4 w-4" />} tone="success" onClick={() => navigate('/dashboard/earnings')} />
        <StatCard label="Conversion" value={`${(percent(totals.sales, totals.views) || 0).toFixed(2)}%`} hint={`${formatNumber(totals.views)} listing views`} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      {pending.length > 0 && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              <p className="text-sm font-medium">{pending.length} submission{pending.length === 1 ? '' : 's'} awaiting review</p>
            </div>
            {pending.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                <span>{entry.bookTitle} · submitted {entry.submittedAt ? timeAgo(entry.submittedAt) : 'just now'}</span>
                <Badge variant="warning">{entry.status.replace('_', ' ')}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Your catalogue</CardTitle>
            <CardDescription>Toggle a listing on or off, adjust pricing and discounts, and see how buyers respond.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search listings" className="h-9 w-[200px] pl-8" aria-label="Search listings" />
            </div>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort listings">
              <option value="sales">Best selling</option>
              <option value="revenue">Highest revenue</option>
              <option value="views">Most viewed</option>
              <option value="rating">Best rated</option>
              <option value="recent">Recently updated</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={view}
            onValueChange={(value) => setView(value as typeof view)}
            tabs={[
              { value: 'listed', label: 'Listed', count: (books ?? []).filter((book) => book.marketplace.listed).length },
              { value: 'unlisted', label: 'Not listed', count: (books ?? []).filter((book) => !book.marketplace.listed).length },
              { value: 'all', label: 'All books', count: books?.length ?? 0 },
            ]}
          />
          {rows.length === 0 ? (
            <EmptyState
              icon={<Store className="h-5 w-5" />}
              title={view === 'listed' ? 'Nothing listed yet' : 'No books match'}
              description={view === 'listed' ? 'Turn on a listing to start selling, or walk through the publishing centre to prepare a title.' : 'Adjust your search or filters to find a title.'}
              actions={view === 'listed' ? <Button size="sm" onClick={() => navigate('/dashboard/publishing')}>Open publishing centre</Button> : undefined}
            />
          ) : (
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} dense onRowClick={(row) => navigate(`/dashboard/books/${row.id}`)} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listing quality</CardTitle>
          <CardDescription>Marketplace listings with complete metadata convert up to 3× better.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(books ?? []).slice(0, 6).map((book) => {
            const checks = [
              { label: 'Description 400+ chars', done: book.description.length >= 400 },
              { label: '5+ keywords', done: book.metadata.keywords.length >= 5 },
              { label: 'Category set', done: book.categoryIds.length > 0 },
              { label: 'Cover artwork', done: Boolean(book.cover.imageUrl) },
              { label: 'Free preview', done: book.marketplace.freePreviewPages > 0 },
            ];
            const score = Math.round((checks.filter((entry) => entry.done).length / checks.length) * 100);
            return (
              <div key={book.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{book.title}</p>
                  <Badge variant={score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger'}>{score}%</Badge>
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {checks.map((entry) => (
                    <li key={entry.label} className="flex items-center gap-1.5">
                      {entry.done ? <BadgeCheck className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-muted-foreground/50" />}
                      <span className={entry.done ? 'text-muted-foreground' : ''}>{entry.label}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="xs" className="mt-3 w-full" onClick={() => navigate(`/dashboard/publishing?book=${book.id}`)}>Fix listing</Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Edit listing · ${editing.title}` : 'Edit listing'}
        description="Price changes apply immediately for new buyers. Existing purchases keep the price they paid."
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              disabled={mutate.isPending}
              onClick={() => {
                if (!editing) return;
                if (draft.listed && !entitlements.canSellBook()) {
                  warning('Marketplace selling is a Pro feature', 'Upgrade to list books for sale.');
                  return;
                }
                mutate.mutate({
                  bookId: editing.id,
                  patch: { price: draft.price, discountPercent: draft.discount, listed: draft.listed, freePreviewPages: draft.freePreviewPages },
                });
                setEditing(null);
              }}
            >
              {mutate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save listing
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="listing-price">List price (USD)</label>
              <Input id="listing-price" type="number" min={0} step={0.5} value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: Math.max(0, Number(event.target.value)) }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="listing-discount">Discount: {draft.discount}%</label>
              <input
                id="listing-discount"
                type="range"
                min={0}
                max={70}
                step={5}
                value={draft.discount}
                onChange={(event) => setDraft((current) => ({ ...current, discount: Number(event.target.value) }))}
                className="w-full accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="listing-preview">Free preview pages</label>
              <Input id="listing-preview" type="number" min={0} max={10} value={draft.freePreviewPages} onChange={(event) => setDraft((current) => ({ ...current, freePreviewPages: Math.max(0, Math.min(10, Number(event.target.value))) }))} />
            </div>
            <label className="flex items-center justify-between gap-3 self-end text-sm">
              <span>Listed on marketplace</span>
              <Switch checked={draft.listed} onCheckedChange={(checked) => setDraft((current) => ({ ...current, listed: checked }))} />
            </label>
          </div>
          <Separator />
          <div className="rounded-lg bg-muted/50 p-3 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Buyer pays</span><span>{formatCurrency(draft.price * (1 - draft.discount / 100))}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">You earn per sale</span><span>{formatCurrency(draft.price * (1 - draft.discount / 100) * 0.85)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Platform fee</span><span>{formatCurrency(draft.price * (1 - draft.discount / 100) * 0.15)}</span></div>
          </div>
          {editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => { info('Listing metadata is edited in the publishing centre.'); navigate(`/dashboard/publishing?book=${editing.id}`); }}>
                <Sparkles className="h-4 w-4" /> Improve metadata
              </Button>
              {editing.marketplace.listed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const id = editing.id;
                    const ok = await confirm({ title: 'Withdraw this listing?', description: 'Readers will no longer be able to buy this title until you re-list it.', destructive: true, confirmLabel: 'Withdraw' });
                    setEditing(null);
                    if (ok) unpublish.mutate(id);
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Withdraw listing
                </Button>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reader signals</CardTitle>
          <CardDescription>Wishlists and ratings you can act on today.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Heart className="h-3.5 w-3.5" /> Wishlisted</p>
            <p className="mt-1 text-lg font-semibold">{formatNumber(totals.favorites)}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Star className="h-3.5 w-3.5" /> Reviews to answer</p>
            <p className="mt-1 text-lg font-semibold">{formatNumber((books ?? []).reduce((total, book) => total + book.marketplace.reviewCount, 0))}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="h-3.5 w-3.5" /> Unconverted views</p>
            <p className="mt-1 text-lg font-semibold">{formatNumber(Math.max(0, totals.views - totals.sales))}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

void cn;
