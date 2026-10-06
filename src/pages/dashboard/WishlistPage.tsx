import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Heart, Search, ShoppingCart, Star, Trash2, TrendingDown, Library } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/components/ui/primitives';
import { EmptyState, Pagination, StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useWishlist } from '@/hooks/queries';
import { marketplaceService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatCompactCurrency, formatCurrency, formatDate, timeAgo } from '@/lib/format';
import { cn, percent } from '@/lib/utils';
import type { Book, WishlistItem } from '@/types/domain';

type WishRow = { item: WishlistItem; book: Book };

export default function WishlistPage() {
  const { user } = useAuth();
  const { success, error, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: wishlist, isLoading } = useWishlist(user?.id);
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<'recent' | 'price-asc' | 'price-desc' | 'rating' | 'discount'>('recent');
  const [page, setPage] = React.useState(1);
  const [busy, setBusy] = React.useState<string | null>(null);
  const perPage = 12;

  const rows = React.useMemo<WishRow[]>(() => {
    const list: WishRow[] = [];
    (wishlist ?? []).forEach((entry) => {
      if (!entry.book) return;
      if (query && !`${entry.book.title} ${entry.book.authorName}`.toLowerCase().includes(query.toLowerCase())) return;
      list.push({ item: entry.item, book: entry.book });
    });
    const effective = (book: Book) => book.marketplace.price * (1 - book.marketplace.discountPercent / 100);
    return [...list].sort((a, b) => {
      if (sort === 'price-asc') return effective(a.book) - effective(b.book);
      if (sort === 'price-desc') return effective(b.book) - effective(a.book);
      if (sort === 'rating') return b.book.marketplace.rating - a.book.marketplace.rating;
      if (sort === 'discount') return b.book.marketplace.discountPercent - a.book.marketplace.discountPercent;
      return a.item.addedAt < b.item.addedAt ? 1 : -1;
    });
  }, [wishlist, query, sort]);

  const stats = React.useMemo(() => {
    const items = rows.map((row) => row.book);
    const total = items.reduce((sum, book) => sum + book.marketplace.price * (1 - book.marketplace.discountPercent / 100), 0);
    const discounted = items.filter((book) => book.marketplace.discountPercent > 0);
    const free = items.filter((book) => book.marketplace.price === 0);
    const savings = items.reduce((sum, book) => sum + book.marketplace.price * (book.marketplace.discountPercent / 100), 0);
    return { total, discounted: discounted.length, free: free.length, savings };
  }, [rows]);

  const buy = async (row: WishRow) => {
    if (!user) return;
    const price = row.book.marketplace.price * (1 - row.book.marketplace.discountPercent / 100);
    const ok = await confirm({
      title: `Buy “${row.book.title}”?`,
      description: price > 0 ? `${formatCurrency(price)} will be charged to your saved card. This is a simulated transaction.` : 'This title is free — it will be added to your library instantly.',
      confirmLabel: price > 0 ? `Pay ${formatCurrency(price)}` : 'Add to library',
    });
    if (!ok) return;
    setBusy(row.item.id);
    try {
      const result = await marketplaceService.purchase(row.book.id, user.id, 'card');
      marketplaceService.removeWishlist(user.id, row.book.id);
      qc.invalidateQueries({ queryKey: ['wishlist'] });
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      success('Purchase complete', `${result.order?.number ?? 'Order'} · ${row.book.title}`);
      navigate(`/read/${row.book.id}`);
    } catch (e) {
      error('Purchase failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: WishRow) => {
    if (!user) return;
    marketplaceService.removeWishlist(user.id, row.book.id);
    qc.invalidateQueries({ queryKey: ['wishlist'] });
    info('Removed from wishlist', row.book.title);
  };

  if (isLoading) return <div className="space-y-4"><div className="h-8 w-48 animate-pulse rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-muted" />)}</div></div>;

  if (!wishlist || wishlist.length === 0) {
    return (
      <EmptyState
        icon={<Heart className="h-5 w-5" />}
        title="Your wishlist is empty"
        description="Save books you want to read later — we will flag price drops and new discounts."
        actions={<Button onClick={() => navigate('/marketplace')}>Find something to read</Button>}
      />
    );
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Wishlist</h1>
          <p className="text-sm text-muted-foreground">Saved titles with live pricing and discounts.</p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search wishlist" className="h-9 w-[220px] pl-8" aria-label="Search wishlist" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saved titles" value={String(rows.length)} hint={`${stats.free} free to read`} icon={<Heart className="h-4 w-4" />} />
        <StatCard label="Basket value" value={formatCompactCurrency(stats.total)} hint="At current prices" icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="On discount" value={String(stats.discounted)} hint={`${formatCurrency(stats.savings)} saved if bought today`} icon={<TrendingDown className="h-4 w-4" />} tone="warning" />
        <StatCard label="Average rating" value={(rows.reduce((sum, row) => sum + row.book.marketplace.rating, 0) / Math.max(1, rows.length)).toFixed(2)} hint="Of everything saved" icon={<Star className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Saved books</CardTitle>
            <CardDescription>Wishlisted books trigger an email when the price drops.</CardDescription>
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort wishlist">
            <option value="recent">Recently added</option>
            <option value="discount">Biggest discount</option>
            <option value="price-asc">Price low to high</option>
            <option value="price-desc">Price high to low</option>
            <option value="rating">Highest rated</option>
          </select>
        </CardHeader>
        <CardContent className="space-y-4">
          {visible.length === 0 && (
            <EmptyState icon={<Search className="h-5 w-5" />} title="No saved books match" description="Try a different search term." actions={<Button variant="outline" size="sm" onClick={() => setQuery('')}>Clear search</Button>} />
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((row) => {
              const { book } = row;
              const price = book.marketplace.price * (1 - book.marketplace.discountPercent / 100);
              const owned = user ? marketplaceService.owns(user.id, book.id) : false;
              return (
                <div key={row.item.id} className="overflow-hidden rounded-xl border">
                  <div className="relative flex h-[190px] items-center justify-center bg-muted/40 p-4">
                    <Link to={`/books/${book.id}`} className="block h-full w-[120px]">
                      <div className="h-full w-full overflow-hidden rounded shadow-page transition-transform hover:scale-[1.03]">
                        {book.cover.imageUrl
                          ? <img src={book.cover.imageUrl} alt={`Cover of ${book.title}`} className="h-full w-full object-cover" />
                          : <div className="flex h-full w-full items-center justify-center bg-brand-gradient p-2 text-center text-xs font-semibold text-white">{book.title}</div>}
                      </div>
                    </Link>
                    {book.marketplace.discountPercent > 0 && (
                      <Badge variant="danger" className="absolute left-3 top-3">−{book.marketplace.discountPercent}%</Badge>
                    )}
                    <Button variant="ghost" size="xs" className="absolute right-2 top-2" onClick={() => remove(row)} aria-label={`Remove ${book.title} from wishlist`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-2 p-3">
                    <div>
                      <p className="truncate text-sm font-medium">{book.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{book.authorName}</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold">{price === 0 ? 'Free' : formatCurrency(price)}</span>
                        {book.marketplace.discountPercent > 0 && <span className="text-xs text-muted-foreground line-through">{formatCurrency(book.marketplace.price)}</span>}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {book.marketplace.rating ? book.marketplace.rating.toFixed(1) : '—'}
                      </span>
                    </div>
                    <p className="text-2xs text-muted-foreground">Saved {formatDate(row.item.addedAt)} · {percent(book.marketplace.favorites, Math.max(1, book.marketplace.views)).toFixed(0)}% of viewers wishlist this</p>
                    <div className="flex items-center gap-1.5">
                      {owned ? (
                        <Button size="xs" className="flex-1" onClick={() => navigate(`/read/${book.id}`)}>
                          <Library className="h-3 w-3" /> Read now
                        </Button>
                      ) : (
                        <Button size="xs" className="flex-1" disabled={busy === row.item.id} onClick={() => buy(row)}>
                          <ShoppingCart className="h-3 w-3" /> {busy === row.item.id ? 'Processing…' : price === 0 ? 'Get free' : 'Buy now'}
                        </Button>
                      )}
                      <Button variant="outline" size="xs" onClick={() => navigate(`/books/${book.id}`)}>Details</Button>
                    </div>
                    {book.marketplace.discountPercent > 0 && (
                      <p className={cn('text-2xs text-emerald-600 dark:text-emerald-400')}>
                        Discount ends soon — last checked {timeAgo(new Date().toISOString())}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
        </CardContent>
      </Card>
    </div>
  );
}
