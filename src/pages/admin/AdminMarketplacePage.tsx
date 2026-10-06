import * as React from 'react';
import { Link } from 'react-router-dom';
import { Eye, Flame, Heart, LayoutGrid, Sparkles, Star, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, Switch } from '@/components/ui/primitives';
import { BarsChart, DonutChart } from '@/components/ui/charts';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminOverview, useMarketplaceSections, keys } from '@/hooks/queries';
import { adminService, marketplaceService, searchService } from '@/services';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { useAdminActor, StatusPill, Toolbar } from './shared';
import { useQueryClient } from '@tanstack/react-query';

const RAILS = [
  { id: 'featured', label: 'Featured carousel', description: 'Hero rail on /marketplace and the homepage spotlight.', icon: <Star className="h-4 w-4" /> },
  { id: 'trending', label: 'Trending now', description: 'Highest velocity this week — recomputed from views and sales.', icon: <Flame className="h-4 w-4" /> },
  { id: 'newReleases', label: 'New releases', description: 'Recently published titles, newest first.', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'bestSellers', label: 'Best sellers', description: 'Ranked by completed sales.', icon: <TrendingUp className="h-4 w-4" /> },
  { id: 'staffPicks', label: 'Staff picks', description: 'Hand-picked by the Scriptora editorial team.', icon: <Heart className="h-4 w-4" /> },
  { id: 'free', label: 'Free reads', description: 'Lead magnets and free serials that feed discovery.', icon: <LayoutGrid className="h-4 w-4" /> },
];

export default function AdminMarketplacePage() {
  const actor = useAdminActor();
  const qc = useQueryClient();
  const { success, info } = useToast();
  const { data: overview } = useAdminOverview();
  const { data: sections, isLoading } = useMarketplaceSections();
  const [category, setCategory] = React.useState('all');
  const [hideFree, setHideFree] = React.useState(false);

  const categories = searchService.categories();

  const toggle = (railId: string, bookId: string, label: string) => {
    const book = (sections?.[railId as keyof typeof sections] ?? []).find((entry) => entry.id === bookId);
    if (!book) return;
    if (railId === 'featured') {
      void adminService.moderateBook(bookId, book.marketplace.featured ? 'unfeature' : 'feature', actor);
      success(book.marketplace.featured ? 'Removed from featured' : 'Added to featured');
    } else if (railId === 'staffPicks') {
      void adminService.moderateBook(bookId, 'staff-pick', actor);
      success('Staff pick updated');
    } else if (railId === 'trending') {
      void adminService.moderateBook(bookId, 'trending', actor);
      success('Trending flag updated');
    } else {
      success(`${label} rail updated`, 'Rail membership follows the catalogue flags you set on each book.');
    }
    void qc.invalidateQueries({ queryKey: keys.marketplaceSections });
    void qc.invalidateQueries({ queryKey: keys.adminBooks() });
  };

  const rails = (sections ?? {}) as Record<string, ReturnType<typeof marketplaceService.featured>>;

  return (
    <div>
      <PageHeader title="Marketplace" description="Merchandising controls for every rail readers browse: featured, trending, staff picks and more." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Listed books" value={formatNumber(overview?.books.published ?? 0)} icon={<LayoutGrid className="h-4 w-4" />} />
        <StatCard label="Views" value={formatNumber(rails.featured?.[0]?.marketplace.views ?? 0)} icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Sales" value={formatNumber(overview?.commerce.sales ?? 0)} change={`${overview?.commerce.conversion ?? 0}% conversion`} />
        <StatCard label="Avg order value" value={formatCurrency(overview?.commerce.avgOrderValue ?? 0)} />
      </div>

      <Toolbar className="mt-4">
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category filter" className="h-9 rounded-md border border-input bg-background px-2 text-xs">
          <option value="all">All categories</option>
          {categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs"><Switch checked={hideFree} onCheckedChange={setHideFree} /> Hide free titles from merchandising rails</label>
        <Button size="sm" variant="ghost" onClick={() => info('Rail composition', 'Featured and staff picks are manual; trending, new releases and best sellers are computed from live activity.')}>How rails work</Button>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Rail popularity</CardTitle></CardHeader>
          <CardContent>
            <BarsChart
              data={RAILS.map((rail) => ({ label: rail.label.replace(' carousel', '').replace(' now', ''), value: (rails[rail.id] ?? []).reduce((total, book) => total + book.marketplace.views, 0) }))}
              dataKey="value"
              currency={false}
              height={240}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Catalogue by category</CardTitle></CardHeader>
          <CardContent>
            <DonutChart height={220} data={categories.slice(0, 6).map((entry) => ({ name: entry.name, value: entry.bookCount ?? 0 }))} />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 space-y-4">
        {isLoading && Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-lg bg-muted" />)}
        {RAILS.map((rail) => {
          const books = (rails[rail.id] ?? []).filter((book) => (category === 'all' || book.categoryIds.includes(category)) && (!hideFree || book.marketplace.price > 0));
          return (
            <Card key={rail.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">{rail.icon} {rail.label} <Badge variant="outline" className="text-2xs">{books.length}</Badge></CardTitle>
                <CardDescription className="text-xs">{rail.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {books.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No titles in this rail right now.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {books.slice(0, 6).map((book) => (
                      <div key={book.id} className="flex gap-3 rounded-lg border p-2">
                        <div className="h-20 w-14 shrink-0 overflow-hidden rounded" style={{ background: `linear-gradient(150deg, ${book.theme.accentColor}, hsl(var(--muted)))` }}>
                          {book.cover.imageUrl && <img src={book.cover.imageUrl} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{book.title}</p>
                          <p className="truncate text-2xs text-muted-foreground">{book.authorName}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-2xs">{book.marketplace.price > 0 ? formatCurrency(book.marketplace.price) : 'Free'}</Badge>
                            <Badge variant="outline" className="text-2xs">{formatNumber(book.marketplace.sales)} sold</Badge>
                            {book.marketplace.staffPick && <Badge variant="info" className="text-2xs">staff</Badge>}
                            {book.marketplace.featured && <Badge variant="accent" className="text-2xs">featured</Badge>}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Button size="xs" variant="outline" onClick={() => toggle(rail.id, book.id, rail.label)}>Toggle rail</Button>
                            <Link to={`/dashboard/books/${book.id}`} className="rounded border px-2 py-0.5 text-2xs hover:bg-muted">Open</Link>
                            <Link to={`/read/${book.id}`} className="rounded px-2 py-0.5 text-2xs hover:bg-muted">Preview</Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!isLoading && RAILS.every((rail) => (rails[rail.id] ?? []).length === 0) && (
        <EmptyState icon={<LayoutGrid className="h-5 w-5" />} title="The marketplace is empty" description="Publish a book with public visibility to populate the rails." />
      )}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recently published</CardTitle>
          <CardDescription className="text-xs">Newest public listings across the catalogue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(rails.newReleases ?? []).map((book) => (
            <div key={book.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
              <span className="min-w-0 truncate">{book.title} <span className="text-2xs text-muted-foreground">by {book.authorName}</span></span>
              <span className="flex items-center gap-2">
                <StatusPill value={book.visibility} />
                <span className="text-2xs text-muted-foreground">{book.publishedAt ? timeAgo(book.publishedAt) : 'not published'}</span>
                <Link to={`/dashboard/books/${book.id}`} className="rounded border px-2 py-0.5 text-2xs hover:bg-muted">Moderate</Link>
              </span>
            </div>
          ))}
          {(rails.newReleases ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nothing published yet.</p>}
          <Separator />
          <p className="text-2xs text-muted-foreground">Moderation actions for individual titles live in <Link to="/admin/books" className="underline">Books</Link>; report handling lives in <Link to="/admin/reports" className="underline">Reports</Link>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
