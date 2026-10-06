import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketplace, useCategories } from '@/hooks/queries';
import { Seo } from '@/components/shared/Seo';
import { BookCard } from '@/components/shared/BookCard';
import { Section, SectionHeading, BreadcrumbBar } from '@/components/shared/sections';
import { Badge, Button, Input, Select, Skeleton } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/data';
import { cn } from '@/lib/utils';
import type { BookKind, MarketplaceFilters } from '@/types/domain';
import { BOOK_KINDS } from '@/data/constants';
import { BOOK_KIND_LABELS } from '@/lib/format';

const COLLECTIONS: { key: string; title: string; description: string; filters: MarketplaceFilters }[] = [
  {
    key: 'free',
    title: 'Free to read',
    description: 'Complete books you can read today at no cost.',
    filters: { query: '', categoryIds: [], priceFilter: 'free', minRating: 0, sort: 'rating', kind: 'all' },
  },
  {
    key: 'fiction',
    title: 'Fiction and novels',
    description: 'Long-form storytelling from independent novelists.',
    filters: { query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'trending', kind: 'fiction' },
  },
  {
    key: 'non-fiction',
    title: 'Ideas and non-fiction',
    description: 'Argument, memoir, history and reportage.',
    filters: { query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'rating', kind: 'nonfiction' },
  },
  {
    key: 'guide',
    title: 'Guides and how-to',
    description: 'Practical books you finish and then use.',
    filters: { query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'bestselling', kind: 'guide' },
  },
];

export default function BooksPage() {
  const navigate = useNavigate();
  const { data: categories } = useCategories('book');
  const [filters, setFilters] = React.useState<MarketplaceFilters>({
    query: '',
    categoryIds: [],
    priceFilter: 'all',
    minRating: 0,
    sort: 'featured',
    kind: 'all',
  });
  const { data: books, isLoading, isError, refetch } = useMarketplace(filters);

  return (
    <>
      <Seo
        title="Books — read everything published with Scriptora"
        description="Browse the Scriptora book catalogue by genre, format and price. Free books, new releases, best sellers and staff picks."
        canonical="/books"
        keywords={['book catalogue', 'free ebooks', 'indie books']}
      />
      <section className="border-b border-border bg-muted/40 py-10">
        <div className="container">
          <BreadcrumbBar items={[{ label: 'Home', href: '/' }, { label: 'Books' }]} />
          <SectionHeading
            eyebrow="Catalogue"
            title="Everything published with Scriptora"
            description="A living catalogue: search it, filter it by genre and read a free preview of any book before you buy."
            align="left"
          />
          <div className="mt-6 flex flex-wrap gap-3">
            <Input
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search the catalogue…"
              aria-label="Search books"
              className="max-w-xs"
            />
            <Select
              value={filters.kind ?? 'all'}
              onChange={(event) => setFilters((current) => ({ ...current, kind: event.target.value as BookKind | 'all' }))}
              aria-label="Filter by book type"
              className="w-[190px]"
            >
              <option value="all">All book types</option>
              {BOOK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {BOOK_KIND_LABELS[kind] ?? kind}
                </option>
              ))}
            </Select>
            <Select
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as MarketplaceFilters['sort'] }))}
              aria-label="Sort books"
              className="w-[190px]"
            >
              {([
                ['featured', 'Featured'],
                ['newest', 'Newest'],
                ['bestselling', 'Best selling'],
                ['rating', 'Highest rated'],
              ] as const).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              value={String(filters.minRating)}
              onChange={(event) => setFilters((current) => ({ ...current, minRating: Number(event.target.value) }))}
              aria-label="Minimum rating"
              className="w-[150px]"
            >
              {[0, 4, 4.5].map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? 'Any rating' : `${value}★ and up`}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilters((current) => ({ ...current, categoryIds: [] }))}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                !filters.categoryIds.length ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
              )}
            >
              All genres
            </button>
            {(categories ?? []).slice(0, 14).map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    categoryIds: current.categoryIds.includes(category.id) ? current.categoryIds.filter((id) => id !== category.id) : [category.id],
                  }))
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs',
                  filters.categoryIds.includes(category.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <Section>
        {isError ? (
          <ErrorState title="The catalogue did not load" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-5">
            {Array.from({ length: 10 }).map((_, index) => (
              <Skeleton key={index} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : !books?.length ? (
          <EmptyState
            icon="▤"
            title="No books match those filters"
            description="Try a wider genre selection or a lower rating threshold."
            actions={
              <Button variant="outline" onClick={() => setFilters({ query: '', categoryIds: [], priceFilter: 'all', minRating: 0, sort: 'featured', kind: 'all' })}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <>
            <p className="mb-5 text-sm text-muted-foreground">{books.length} books</p>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
              ))}
            </div>
          </>
        )}
      </Section>

      {COLLECTIONS.map((collection, index) => (
        <CollectionRail key={collection.key} collection={collection} tone={index % 2 === 0 ? 'muted' : 'default'} />
      ))}

      <Section tone="paper">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Add your book to the catalogue</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Publish once and your book appears here, on your author profile and in the marketplace reader — with real analytics behind it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="secondary">Free listings allowed</Badge>
              <Badge variant="secondary">Set your own price</Badge>
              <Badge variant="secondary">Keep up to 92%</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/dashboard/books/new')}>Start a book</Button>
            <Button variant="outline" onClick={() => navigate('/publishing')}>
              Publishing guide
            </Button>
          </div>
        </div>
      </Section>
    </>
  );
}


function CollectionRail({
  collection,
  tone,
}: {
  collection: { key: string; title: string; description: string; filters: MarketplaceFilters };
  tone: 'default' | 'muted';
}) {
  const { data, isLoading } = useMarketplace(collection.filters);
  if (isLoading) {
    return (
      <Section tone={tone}>
        <SectionHeading title={collection.title} description={collection.description} align="left" />
        <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-xl" />
          ))}
        </div>
      </Section>
    );
  }
  if (!data?.length) return null;
  return (
    <Section tone={tone}>
      <SectionHeading title={collection.title} description={collection.description} align="left" />
      <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
        {data.slice(0, 4).map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </Section>
  );
}
