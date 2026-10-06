import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketplace, useMarketplaceSections, useWishlist, useCategories } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { marketplaceService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { BookCard } from '@/components/shared/BookCard';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Input, Select, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState, Pagination } from '@/components/ui/data';
import { cn } from '@/lib/utils';
import type { MarketplaceFilters } from '@/types/domain';

const SORTS: { value: MarketplaceFilters['sort']; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'trending', label: 'Trending' },
  { value: 'newest', label: 'Newest' },
  { value: 'bestselling', label: 'Best selling' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

const PRICE_FILTERS: { value: MarketplaceFilters['priceFilter']; label: string }[] = [
  { value: 'all', label: 'Any price' },
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
  { value: 'under5', label: 'Under $5' },
  { value: 'under10', label: 'Under $10' },
];

const PER_PAGE = 12;

export default function MarketplacePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, info } = useToast();
  const { data: sections } = useMarketplaceSections();
  const { data: categories } = useCategories('book');
  const { data: wishlist } = useWishlist(user?.id);

  const [filters, setFilters] = React.useState<MarketplaceFilters>({
    query: '',
    categoryIds: [],
    priceFilter: 'all',
    minRating: 0,
    sort: 'featured',
    kind: 'all',
  });
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [page, setPage] = React.useState(1);

  const { data: books, isLoading, isError, refetch } = useMarketplace(filters);
  const wishlistIds = React.useMemo(() => new Set((wishlist ?? []).map((entry) => entry.item.bookId)), [wishlist]);
  const totalPages = Math.max(1, Math.ceil((books?.length ?? 0) / PER_PAGE));
  const visible = (books ?? []).slice((page - 1) * PER_PAGE, page * PER_PAGE);

  React.useEffect(() => setPage(1), [filters]);

  const toggleCategory = (categoryId: string) => {
    setFilters((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(categoryId)
        ? current.categoryIds.filter((id) => id !== categoryId)
        : [...current.categoryIds, categoryId],
    }));
  };

  const toggleWishlist = async (bookId: string, title: string) => {
    if (!user) {
      navigate('/login?next=/marketplace');
      return;
    }
    const result = await marketplaceService.toggleWishlist(user.id, bookId);
    success(result.added ? 'Added to wishlist' : 'Removed from wishlist', title);
  };

  const rails: { key: string; title: string; description: string; books: typeof books }[] = [
    { key: 'featured', title: 'Featured this week', description: 'Hand-picked by the Scriptora editorial team.', books: sections?.featured },
    { key: 'trending', title: 'Trending now', description: 'Most viewed and most wishlisted in the last 14 days.', books: sections?.trending },
    { key: 'new', title: 'New releases', description: 'Freshly published by independent authors.', books: sections?.newReleases },
    { key: 'bestsellers', title: 'Best sellers', description: 'Highest sales across the marketplace.', books: sections?.bestSellers },
  ];

  return (
    <>
      <Seo
        title="Marketplace — buy direct from independent authors"
        description="Browse books published with Scriptora: read a free preview, buy securely, and read in the built-in reader with bookmarks and progress."
        canonical="/marketplace"
        keywords={['indie book marketplace', 'buy ebooks direct', 'independent authors']}
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Marketplace' }]} />
          <SectionHeading
            eyebrow="Marketplace"
            title="Books published with Scriptora"
            description="Every listing comes with a free preview, a real reading experience and an author who keeps the majority of the sale."
            align="left"
          />
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="min-w-[240px] flex-1">
              <Input
                value={filters.query}
                onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Search titles, authors, tags…"
                aria-label="Search the marketplace"
              />
            </div>
            <Select
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as MarketplaceFilters['sort'] }))}
              aria-label="Sort results"
              className="w-[190px]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              value={filters.priceFilter}
              onChange={(event) => setFilters((current) => ({ ...current, priceFilter: event.target.value as MarketplaceFilters['priceFilter'] }))}
              aria-label="Filter by price"
              className="w-[150px]"
            >
              {PRICE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className="flex rounded-lg border border-input" role="group" aria-label="View mode">
              {(['grid', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  className={cn('px-3 py-2 text-xs font-medium capitalize transition-colors', view === mode ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Categories:</span>
            {(categories ?? []).slice(0, 12).map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => toggleCategory(category.id)}
                aria-pressed={filters.categoryIds.includes(category.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  filters.categoryIds.includes(category.id)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Minimum rating
              <Select
                value={String(filters.minRating)}
                onChange={(event) => setFilters((current) => ({ ...current, minRating: Number(event.target.value) }))}
                aria-label="Minimum rating"
                className="h-8 w-[92px]"
              >
                {[0, 3, 4, 4.5].map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? 'Any' : `${value}★+`}
                  </option>
                ))}
              </Select>
            </label>
            {(filters.query || filters.categoryIds.length || filters.priceFilter !== 'all' || filters.minRating > 0) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFilters({ query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'featured', kind: 'all' })}
              >
                Clear all filters
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {isLoading ? 'Searching…' : `${books?.length ?? 0} books match`}
            </span>
          </div>
        </div>
      </section>

      <Section>
        {isError ? (
          <ErrorState title="The marketplace did not load" description="We could not reach the catalogue." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-80 rounded-xl" />
            ))}
          </div>
        ) : !visible.length ? (
          <EmptyState
            icon="◈"
            title="No books match those filters"
            description="Try a broader price range, fewer categories or a lower rating threshold."
            actions={
              <Button variant="outline" onClick={() => setFilters({ query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'featured', kind: 'all' })}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <>
            {view === 'grid' ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    inWishlist={wishlistIds.has(book.id)}
                    onWishlist={() => toggleWishlist(book.id, book.title)}
                    onPreview={() => info('Free preview', 'Open the book page to start reading the preview.')}
                  />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {visible.map((book) => (
                  <li key={book.id} className="flex flex-col gap-4 p-4 sm:flex-row">
                    <button type="button" onClick={() => navigate(`/marketplace/${book.id}`)} className="shrink-0" aria-label={`Open ${book.title}`}>
                      <img src={book.cover.imageUrl} alt="" className="h-36 w-24 rounded-md object-cover shadow-soft" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => navigate(`/marketplace/${book.id}`)} className="text-left">
                        <h3 className="text-base font-semibold text-foreground hover:text-primary">{book.title}</h3>
                      </button>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        by <span className="text-foreground">{book.authorName}</span> · {book.kind.replace('-', ' ')} · {book.pageCount} pages
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{book.shortDescription || book.description}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{book.marketplace.rating.toFixed(1)}★ · {book.marketplace.reviewCount} reviews</Badge>
                        <Badge variant="outline">{book.marketplace.sales.toLocaleString()} sold</Badge>
                        {book.marketplace.discountPercent > 0 && <Badge variant="danger">−{book.marketplace.discountPercent}%</Badge>}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-start justify-between gap-2 sm:items-end">
                      <p className="text-lg font-semibold text-foreground">
                        {book.marketplace.price === 0 ? <span className="text-success">Free</span> : `$${book.marketplace.price.toFixed(2)}`}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => toggleWishlist(book.id, book.title)}>
                          {wishlistIds.has(book.id) ? '♥ Saved' : '♡ Save'}
                        </Button>
                        <Button size="sm" onClick={() => navigate(`/marketplace/${book.id}`)}>
                          View
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {totalPages > 1 && (
              <div className="mt-8">
                <Pagination page={page} pageCount={totalPages} total={books?.length} pageSize={PER_PAGE} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </Section>

      {rails.map((rail) =>
        rail.books && rail.books.length > 0 ? (
          <Section key={rail.key} tone={rail.key === 'trending' || rail.key === 'bestsellers' ? 'muted' : 'default'}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHeading title={rail.title} description={rail.description} align="left" />
              <Button variant="ghost" onClick={() => navigate('/marketplace')}>
                See all →
              </Button>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-5 lg:grid-cols-4">
              {rail.books.slice(0, 4).map((book) => (
                <BookCard key={book.id} book={book} inWishlist={wishlistIds.has(book.id)} onWishlist={() => toggleWishlist(book.id, book.title)} />
              ))}
            </div>
          </Section>
        ) : null,
      )}

      <Section tone="paper">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <div>
            <SectionHeading eyebrow="Sell here" title="List your book and keep up to 92%" description="Publishing to the marketplace takes ten guided steps. Set your price, choose visibility, and start earning from the project you already made." align="left" />
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => navigate('/dashboard/publishing')}>Publish a book</Button>
              <Button variant="outline" onClick={() => navigate('/publishing')}>
                How publishing works
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['Pro authors', 'Keep 85% of every sale with a 30-day payout cycle.'],
              ['Business authors', 'Keep 92%, with higher AI limits and team seats.'],
              ['Refunds', 'A 14-day window, tracked against your earnings honestly.'],
              ['No exclusivity', 'Sell elsewhere too. Scriptora never locks your book in.'],
            ] as const).map(([title, body]) => (
              <div key={title} className="rounded-xl border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
