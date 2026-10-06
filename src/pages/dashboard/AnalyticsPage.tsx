import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Download, Eye, Heart, MousePointerClick, ShoppingCart, Star, TrendingUp, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { DonutChart, RevenueAreaChart } from '@/components/ui/charts';
import { useAnalytics, useBookCounts, useBooks, usePlatformAnalytics, useRevenueSeries } from '@/hooks/queries';
import { analyticsService, revenueService } from '@/services';
import type { PeriodKey } from '@/services/revenueService';
import { useAuth } from '@/providers/AuthProvider';
import { formatCurrency, formatNumber, formatPercent, statusLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BookAnalytics } from '@/services/analyticsService';

type Metric = 'revenue' | 'sales' | 'views';

export default function AnalyticsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = React.useState<PeriodKey>('30d');
  const [metric, setMetric] = React.useState<Metric>('views');
  const { data: analytics } = useAnalytics(user?.id, period);
  const summary = analytics?.summary;
  const { data: series } = useRevenueSeries(user?.id, period, metric);
  const { data: counts } = useBookCounts(user?.id);
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });

  const breakdown = React.useMemo<BookAnalytics[]>(() => analytics?.books ?? [], [analytics]);
  const sources = React.useMemo(() => analytics?.sources ?? [], [analytics]);
  const countries = React.useMemo(() => (user ? analyticsService.readersByCountry(user.id) : []), [user]);
  const platform = usePlatformAnalytics(period);

  const sourceNames: Record<string, string> = {
    marketplace: 'Marketplace',
    'author-page': 'Author page',
    search: 'Search',
    external: 'External links',
    internal: 'In-app',
  };

  const breakdownColumns: Column<BookAnalytics>[] = [
    {
      key: 'title',
      header: 'Book',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-10 w-7 shrink-0 overflow-hidden rounded-sm bg-muted">
            {row.cover ? <img src={row.cover} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <span className="truncate text-sm font-medium">{row.title}</span>
        </div>
      ),
    },
    { key: 'views', header: 'Views', align: 'right', sortable: true, render: (row) => formatNumber(row.views) },
    { key: 'sales', header: 'Sales', align: 'right', sortable: true, render: (row) => formatNumber(row.sales) },
    { key: 'conversion', header: 'Conversion', align: 'right', render: (row) => `${row.conversion.toFixed(2)}%` },
    { key: 'favorites', header: 'Wishlisted', align: 'right', render: (row) => formatNumber(row.favorites) },
    { key: 'reviews', header: 'Reviews', align: 'right', render: (row) => formatNumber(row.reviews) },
    { key: 'rating', header: 'Rating', align: 'right', render: (row) => row.rating ? <span className="inline-flex items-center gap-1">{row.rating.toFixed(1)} <Star className="h-3 w-3 fill-amber-400 text-amber-400" /></span> : <span className="text-muted-foreground">—</span> },
    { key: 'revenue', header: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
    { key: 'downloads', header: 'Downloads', align: 'right', render: (row) => formatNumber(row.downloads) },
  ];

  if (!books || books.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 className="h-5 w-5" />}
        title="No analytics yet"
        description="Analytics appear once you have a book and some reader activity."
        actions={<Button onClick={() => navigate('/dashboard/books/new')}>Create a book</Button>}
      />
    );
  }

  const totals = breakdown.reduce(
    (acc, row) => ({ views: acc.views + row.views, sales: acc.sales + row.sales, revenue: acc.revenue + row.revenue, downloads: acc.downloads + row.downloads }),
    { views: 0, sales: 0, revenue: 0, downloads: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">How readers find, sample and buy your books.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Period">
            {revenueService.periods.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/exports')}>
            <Download className="h-4 w-4" /> Export files
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Views" value={formatNumber(summary?.views ?? totals.views)} change={summary ? `${summary.changePct.views > 0 ? '+' : ''}${summary.changePct.views}%` : undefined} hint="Marketplace + author page" icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Sales" value={formatNumber(summary?.totalSales ?? totals.sales)} change={summary ? `${summary.changePct.sales > 0 ? '+' : ''}${summary.changePct.sales}%` : undefined} hint={`${counts?.published ?? 0} published titles`} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Conversion" value={`${(summary?.conversionRate ?? 0).toFixed(2)}%`} change={summary ? `${summary.changePct.conversion > 0 ? '+' : ''}${summary.changePct.conversion}%` : undefined} hint="Views that became sales" icon={<MousePointerClick className="h-4 w-4" />} />
        <StatCard label="Revenue" value={formatCurrency(summary?.netEarnings ?? totals.revenue)} change={summary ? `${summary.changePct.revenue > 0 ? '+' : ''}${summary.changePct.revenue}%` : undefined} hint="Net of platform fees" icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Trend</CardTitle>
            <CardDescription>{revenueService.periods.find((entry) => entry.key === period)?.label} · {metric}</CardDescription>
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {(['revenue', 'sales', 'views'] as Metric[]).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setMetric(entry)}
                className={cn('rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors', metric === entry ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                aria-pressed={metric === entry}
              >
                {entry}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <RevenueAreaChart
            data={(series ?? []).map((point) => ({ label: point.label, value: point.value, secondary: point.secondary }))}
            currency={metric === 'revenue'}
            height={280}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Traffic sources</CardTitle>
            <CardDescription>Where your readers came from across {summary?.views ? formatNumber(summary.views) : 'all'} views.</CardDescription>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No view events recorded yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
                <DonutChart data={sources.map((entry) => ({ name: sourceNames[entry.source] ?? entry.source, value: entry.count }))} height={200} />
                <div className="space-y-2">
                  {sources.map((entry) => (
                    <div key={entry.source}>
                      <div className="flex items-center justify-between text-xs">
                        <span>{sourceNames[entry.source] ?? entry.source}</span>
                        <span className="text-muted-foreground">{entry.count} · {entry.percent}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${entry.percent}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Readers by country</CardTitle>
            <CardDescription>Based on completed sales.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {countries.length === 0 && <p className="text-sm text-muted-foreground">No sales data yet.</p>}
            {countries.slice(0, 8).map((entry, index) => (
              <div key={entry.country} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-muted-foreground">{index + 1}</span>
                  <span className="text-sm">{entry.country}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{entry.sales} sales</span>
                  <span className="font-medium text-foreground">{formatCurrency(entry.revenue)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Downloads" value={formatNumber(summary?.downloads ?? totals.downloads)} hint="Delivered files" icon={<Download className="h-4 w-4" />} />
        <StatCard label="Wishlisted" value={formatNumber(summary?.favorites ?? 0)} hint="Readers saving for later" icon={<Heart className="h-4 w-4" />} />
        <StatCard label="Reviews" value={formatNumber(summary?.reviews ?? 0)} hint={summary?.avgRating ? `${summary.avgRating.toFixed(2)} average rating` : 'No ratings yet'} icon={<Star className="h-4 w-4" />} />
        <StatCard label="Refunds" value={formatNumber(summary?.refunds ?? 0)} hint="Out of all completed orders" icon={<Users className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-book performance</CardTitle>
          <CardDescription>Sort any column to find your best and worst performers.</CardDescription>
        </CardHeader>
        <CardContent>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No books to analyse yet.</p>
          ) : (
            <DataTable
              columns={breakdownColumns}
              rows={breakdown.map((row) => ({ ...row, id: row.bookId }))}
              rowKey={(row) => row.bookId}
              onRowClick={(row) => navigate(`/dashboard/books/${row.bookId}`)}
              dense
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform benchmark</CardTitle>
          <CardDescription>How Scriptora overall is performing — useful context for your own numbers.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Benchmark label="Active readers" value={formatNumber(platform.data?.users ?? 0)} />
          <Benchmark label="Books published" value={formatNumber(platform.data?.publishings ?? 0)} />
          <Benchmark label="Marketplace sales" value={formatNumber(platform.data?.orders ?? 0)} />
          <Benchmark label="Platform revenue" value={formatCurrency(platform.data?.revenue ?? 0)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Book status snapshot</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {Object.entries(counts ?? {}).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
              <Badge variant={key === 'published' ? 'success' : key === 'trashed' ? 'danger' : 'secondary'}>{statusLabel(key)}</Badge>
              <span className="text-sm font-medium">{formatNumber(value)}</span>
            </div>
          ))}
          <Separator orientation="vertical" className="h-auto" />
          <p className="self-center text-xs text-muted-foreground">Updated live from your library as you publish.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Benchmark({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

