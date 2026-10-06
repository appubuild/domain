import * as React from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, BookOpen, CreditCard, Flag, Gauge, HardDrive, Sparkles, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { BarsChart, DonutChart, LinesChart } from '@/components/ui/charts';
import { EmptyState, ProgressList, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useAdminGrowth, useAdminOverview, useAuditLogs, useModerationQueue, useReports } from '@/hooks/queries';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { formatBytes } from '@/lib/utils';
import { useAdminActor } from './shared';

const PERIODS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '12 months' },
];

export default function AdminDashboardPage() {
  const [period, setPeriod] = React.useState('30d');
  const actor = useAdminActor();
  const { data: overview, isLoading, isError, refetch } = useAdminOverview();
  const { data: growth } = useAdminGrowth(period);
  const { data: queue } = useModerationQueue();
  const { data: reports } = useReports();
  const { data: logs } = useAuditLogs({});

  if (isError) {
    return <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="Overview unavailable" description="The admin metrics could not be loaded." actions={<Button onClick={() => void refetch()}>Retry</Button>} />;
  }

  const chartData = (growth ?? []).map((point) => ({ label: point.label, users: point.users, books: point.books, revenue: point.revenue }));

  return (
    <div>
      <PageHeader title="Platform overview" description={`Signed in as ${actor.name}. Live figures from the mock data provider.`}>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((entry) => (
            <Button key={entry.value} size="xs" variant={period === entry.value ? 'secondary' : 'outline'} onClick={() => setPeriod(entry.value)}>{entry.label}</Button>
          ))}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={formatNumber(overview?.users.total ?? 0)} change={`${overview && overview.users.growthPct >= 0 ? '+' : ''}${overview?.users.growthPct ?? 0}%`} hint={`${overview?.users.new7d ?? 0} joined this week · ${overview?.users.suspended ?? 0} suspended`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Books" value={formatNumber(overview?.books.total ?? 0)} change={`+${overview?.books.created7d ?? 0} this week`} hint={`${overview?.books.published ?? 0} published · ${overview?.books.drafts ?? 0} drafts`} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Gross revenue" value={formatCurrency(overview?.commerce.revenue ?? 0)} change={`${formatCurrency(overview?.commerce.platformFees ?? 0)} fees`} hint={`${overview?.commerce.sales ?? 0} sales · ${overview?.commerce.conversion ?? 0}% conversion`} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="AI usage" value={`${formatNumber(overview?.ai.creditsUsed ?? 0)} credits`} change={`${formatNumber(overview?.ai.requests ?? 0)} requests`} hint={`Top action: ${overview?.ai.topFeature ?? '—'}`} icon={<Sparkles className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Growth &amp; revenue</CardTitle>
            <CardDescription className="text-xs">Signups, new books and completed sales over the selected window.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="h-60 animate-pulse rounded bg-muted" /> : <LinesChart data={chartData} series={[{ key: 'users', label: 'New users', color: 'hsl(var(--primary))' }, { key: 'books', label: 'New books', color: '#34d399' }]} height={220} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue mix</CardTitle>
            <CardDescription className="text-xs">Author payouts vs platform fees.</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart
              currency
              height={200}
              data={[
                { name: 'Author payouts', value: Math.round((overview?.commerce.revenue ?? 0) - (overview?.commerce.platformFees ?? 0)) },
                { name: 'Platform fees', value: overview?.commerce.platformFees ?? 0 },
                { name: 'Refunds', value: overview?.commerce.refunds ?? 0 },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue trend</CardTitle></CardHeader>
          <CardContent>{growth ? <BarsChart data={chartData} dataKey="revenue" currency height={200} /> : <div className="h-48 animate-pulse rounded bg-muted" />}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Moderation queue</CardTitle>
            <CardDescription className="text-xs">{overview?.pending.reviews ?? 0} reviews · {overview?.pending.reports ?? 0} reports · {overview?.pending.submissions ?? 0} submissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(queue ?? []).slice(0, 4).map((review) => (
              <div key={review.id} className="rounded border p-2 text-xs">
                <p className="truncate font-medium">{review.title}</p>
                <p className="truncate text-2xs text-muted-foreground">{review.userName} · {review.rating}★ · {timeAgo(review.createdAt)}</p>
              </div>
            ))}
            {(queue ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nothing waiting for review.</p>}
            <div className="flex gap-1.5">
              <Link to="/admin/reviews" className="rounded-md border px-2 py-1 text-2xs hover:bg-muted">Open reviews</Link>
              <Link to="/admin/reports" className="rounded-md px-2 py-1 text-2xs hover:bg-muted">Open reports</Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Infrastructure</CardTitle>
            <CardDescription className="text-xs">Storage, upkeep and platform health.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ProgressList
              items={[
                { label: 'Storage used', value: overview?.storage.quotaBytes ? Math.round((overview.storage.usedBytes / overview.storage.quotaBytes) * 100) : 0, hint: `${formatBytes(overview?.storage.usedBytes ?? 0)} of ${formatBytes(overview?.storage.quotaBytes ?? 0)}` },
                { label: 'Subscriptions active', value: Math.round(((overview?.subscriptions.active ?? 0) / Math.max(1, (overview?.subscriptions.active ?? 0) + (overview?.subscriptions.canceled ?? 0))) * 100), hint: `${overview?.subscriptions.active ?? 0} active · ${overview?.subscriptions.canceled ?? 0} canceled · ${overview?.subscriptions.churnRate ?? 0}% churn` },
                { label: 'AI credits consumed', value: overview?.ai.creditsUsed ? Math.min(100, Math.round((overview.ai.creditsUsed / Math.max(1, overview.ai.creditsUsed + 2000)) * 100)) : 0, hint: `${formatNumber(overview?.ai.imageCredits ?? 0)} image credits` },
              ]}
            />
            <Separator />
            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground"><HardDrive className="h-3 w-3" /> Largest file: {overview?.storage.largestFile ?? '—'} ({formatBytes(overview?.storage.largestFileBytes ?? 0)})</p>
            <p className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Gauge className="h-3 w-3" /> Avg order value {formatCurrency(overview?.commerce.avgOrderValue ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent admin activity</CardTitle>
            <CardDescription className="text-xs">Every privileged action is written to the audit log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(logs ?? []).slice(0, 6).map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-3 border-b pb-1.5 text-xs last:border-0">
                <div className="min-w-0">
                  <p className="truncate"><span className="font-medium">{log.adminName}</span> {log.action} <span className="text-muted-foreground">{log.targetType}</span> {log.target}</p>
                  <p className="text-2xs text-muted-foreground">{log.before || '—'} → {log.after || '—'} · {log.ip}</p>
                </div>
                <span className="whitespace-nowrap text-2xs text-muted-foreground">{timeAgo(log.createdAt)}</span>
              </div>
            ))}
            {(logs ?? []).length === 0 && <p className="text-xs text-muted-foreground">No admin actions recorded yet.</p>}
            <Link to="/admin/audit-logs" className="rounded-md border px-2 py-1 text-2xs hover:bg-muted">Full audit log</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Open reports</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(reports ?? []).filter((report) => report.status !== 'resolved' && report.status !== 'dismissed').slice(0, 4).map((report) => (
              <div key={report.id} className="rounded border p-2 text-xs">
                <p className="flex items-center gap-1.5 truncate font-medium"><Flag className="h-3 w-3 text-destructive" /> {report.targetLabel}</p>
                <p className="text-2xs text-muted-foreground capitalize">{report.reason} · {report.status} · {timeAgo(report.createdAt)}</p>
              </div>
            ))}
            {(reports ?? []).filter((report) => report.status !== 'resolved').length === 0 && <p className="text-xs text-muted-foreground">No open reports. </p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-1.5 text-sm"><Activity className="h-4 w-4" /> Quick actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {[
            ['/admin/books', 'Moderate books'],
            ['/admin/users', 'Manage users'],
            ['/admin/plans', 'Edit plans & entitlements'],
            ['/admin/cms', 'Edit public pages'],
            ['/admin/flags', 'Toggle feature flags'],
            ['/admin/storage', 'Storage & cleanup'],
            ['/admin/settings', 'Platform settings'],
          ].map(([to, label]) => (
            <Link key={to} to={to} className="rounded-md border px-2.5 py-1.5 text-2xs hover:bg-muted">{label}</Link>
          ))}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <Badge variant="outline">{overview?.subscriptions.active ?? 0} active subscriptions</Badge>
        <Badge variant="outline">{overview?.books.trashed ?? 0} trashed books</Badge>
        <Badge variant="outline">{formatNumber(overview?.ai.imageCredits ?? 0)} image credits</Badge>
      </div>
    </div>
  );
}
