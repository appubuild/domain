import * as React from 'react';
import { AlertTriangle, BookOpen, Eye, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { BarsChart, DonutChart, LinesChart, RevenueAreaChart } from '@/components/ui/charts';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useAdminBooks, useAdminGrowth, useAdminOverview, useCategories, usePlatformAnalytics } from '@/hooks/queries';
import { formatCurrency, formatNumber } from '@/lib/format';
import { Toolbar, FilterSelect } from './shared';

const PERIODS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '12 months' },
  { value: 'all', label: 'All time' },
];

type Row = { id: string; name: string; books: number; views: number; sales: number; revenue: number; conversion: number };

export default function AdminAnalyticsPage() {
  const [period, setPeriod] = React.useState('30d');
  const [metric, setMetric] = React.useState<'revenue' | 'sales' | 'views'>('revenue');
  const { data: overview } = useAdminOverview();
  const { data: growth } = useAdminGrowth(period);
  const { data: analytics, isLoading } = usePlatformAnalytics(period);
  const { data: topBooks } = useAdminBooks({ sort: 'sales' });
  const { data: categories } = useCategories('book');
  const { isError, refetch } = useAdminOverview();

  if (isError) {
    return <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="Analytics unavailable" description="The reporting service did not respond." actions={<Button onClick={() => void refetch()}>Retry</Button>} />;
  }

  const rows: Row[] = (topBooks ?? []).slice(0, 12).map((book) => ({
    id: book.id,
    name: book.title,
    books: 1,
    views: book.marketplace.views,
    sales: book.marketplace.sales,
    revenue: Number((book.marketplace.sales * book.marketplace.price * 0.85).toFixed(2)),
    conversion: book.marketplace.views > 0 ? Number(((book.marketplace.sales / book.marketplace.views) * 100).toFixed(1)) : 0,
  }));
  const trend = (growth ?? []).map((point) => ({ label: point.label, revenue: point.revenue, sales: point.sales, views: Math.round(point.revenue / 4) }));

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Book', render: (row) => <span className="font-medium">{row.name}</span> },
    { key: 'views', header: 'Views', align: 'right', sortable: true, render: (row) => formatNumber(row.views) },
    { key: 'sales', header: 'Sales', align: 'right', sortable: true, render: (row) => formatNumber(row.sales) },
    { key: 'revenue', header: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
    { key: 'conversion', header: 'Conversion', align: 'right', sortable: true, render: (row) => `${row.conversion}%` },
  ];

  const chartData = (growth ?? []).map((point) => ({ label: point.label, users: point.users, books: point.books, sales: point.sales, revenue: point.revenue }));

  return (
    <div>
      <PageHeader title="Analytics" description="Traffic, catalogue growth, conversion and AI consumption across the platform." />
      <Toolbar>
        <FilterSelect label="Period" value={period} onChange={setPeriod} options={PERIODS} />
        <FilterSelect
          label="Trend metric"
          value={metric}
          onChange={(value) => setMetric(value as typeof metric)}
          options={[
            { value: 'revenue', label: 'Revenue' },
            { value: 'sales', label: 'Sales' },
            { value: 'views', label: 'Views' },
          ]}
        />
        <span className="text-2xs text-muted-foreground">Charts read from the analytics service — the same data the author dashboards use.</span>
      </Toolbar>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered users" value={formatNumber(overview?.users.total ?? 0)} change={`+${overview?.users.new7d ?? 0} / 7d`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Catalogue" value={formatNumber(overview?.books.total ?? 0)} change={`${overview?.books.published ?? 0} published`} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Period sales" value={formatNumber(analytics?.orders ?? 0)} change={`${formatNumber(analytics?.publishings ?? 0)} published`} icon={<Eye className="h-4 w-4" />} />
        <StatCard label="Revenue" value={formatCurrency(analytics?.revenue ?? 0)} change={`${formatCurrency(analytics?.fees ?? 0)} fees`} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm capitalize">{metric} over time</CardTitle>
            <CardDescription className="text-xs">{PERIODS.find((entry) => entry.value === period)?.label} window</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="h-60 animate-pulse rounded bg-muted" /> : metric === 'revenue'
              ? <RevenueAreaChart data={trend} dataKey="revenue" height={240} />
              : <BarsChart data={trend} dataKey={metric} currency={false} height={240} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Catalogue mix</CardTitle></CardHeader>
          <CardContent>
            <DonutChart
              height={220}
              data={(categories ?? []).filter((category) => (category.bookCount ?? 0) > 0).slice(0, 6).map((category) => ({ name: category.name, value: category.bookCount ?? 0 }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Acquisition &amp; output</CardTitle></CardHeader>
          <CardContent><LinesChart data={chartData} series={[{ key: 'users', label: 'Signups', color: 'hsl(var(--primary))' }, { key: 'books', label: 'Books created', color: '#34d399' }]} height={220} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Sales vs revenue</CardTitle></CardHeader>
          <CardContent><BarsChart data={chartData} dataKey="sales" stackedKey="revenue" stackedLabel="Revenue" height={220} /></CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top performing books</CardTitle>
          <CardDescription className="text-xs">Sort any column; conversion is sales ÷ views.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyState={<EmptyState icon={<BookOpen className="h-5 w-5" />} title="No marketplace activity yet" description="Books start appearing here once they are published to the marketplace." />}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">AI consumption</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p className="flex justify-between"><span className="text-muted-foreground">Credits</span><span>{formatNumber(overview?.ai.creditsUsed ?? 0)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Requests</span><span>{formatNumber(overview?.ai.requests ?? 0)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Top action</span><span>{overview?.ai.topFeature ?? '—'}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Conversion funnel</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p className="flex justify-between"><span className="text-muted-foreground">Books created</span><span>{formatNumber(analytics?.books ?? 0)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Publishings</span><span>{formatNumber(analytics?.publishings ?? 0)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">AI credits</span><span>{formatNumber(analytics?.aiCredits ?? 0)}</span></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Subscriptions</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            <p className="flex justify-between"><span className="text-muted-foreground">Active</span><span>{overview?.subscriptions.active ?? 0}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">MRR</span><span>{formatCurrency(overview?.subscriptions.mrr ?? 0)}</span></p>
            <p className="flex justify-between"><span className="text-muted-foreground">Churn</span><span>{overview?.subscriptions.churnRate ?? 0}%</span></p>
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-2xs text-muted-foreground"><Sparkles className="h-3 w-3" /> Metrics are derived deterministically from the mock database, so numbers move as you create books, run exports and sell in the marketplace.</p>
    </div>
  );
}
