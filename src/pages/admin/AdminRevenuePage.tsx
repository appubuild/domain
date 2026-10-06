import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeDollarSign, Banknote, CheckCircle2, Clock, Download, Wallet } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { BarsChart, DonutChart, RevenueAreaChart } from '@/components/ui/charts';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { adminService } from '@/services';
import { formatCurrency, formatDate, formatNumber, timeAgo } from '@/lib/format';
import { useAdminActor, FilterSelect, StatusPill, Toolbar } from './shared';

type Payout = ReturnType<typeof adminService.payoutQueue>[number];

const PERIODS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '12 months' },
  { value: 'all', label: 'All time' },
];

export default function AdminRevenuePage() {
  const actor = useAdminActor();
  const { success, info } = useToast();
  const [period, setPeriod] = React.useState<'7d' | '30d' | '90d' | '1y' | 'all'>('30d');
  const [tab, setTab] = React.useState<'overview' | 'payouts'>('overview');
  const [method, setMethod] = React.useState('all');
  const [refreshKey, setRefreshKey] = React.useState(0);

  const summary = React.useMemo(() => adminService.revenueSummary(period), [period, refreshKey]);
  const series = React.useMemo(() => adminService.revenueSeries(period), [period, refreshKey]);
  const payouts = React.useMemo(() => adminService.payoutQueue(), [refreshKey]);

  const payoutColumns: Column<Payout>[] = [
    {
      key: 'author',
      header: 'Author',
      render: (row) => (
        <div className="min-w-0">
          <Link to={`/admin/users/${row.userId}`} className="truncate text-xs font-medium hover:underline">{row.userName}</Link>
          <p className="truncate text-2xs text-muted-foreground">{row.email} · {row.method}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'requestedAt', header: 'Requested', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.requestedAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === 'pending' ? (
            <>
              <Button size="xs" onClick={() => { adminService.markPayoutPaid(row.id, actor, 'approve'); success('Payout approved', `${formatCurrency(row.amount)} scheduled for ${row.userName}.`); setRefreshKey((key) => key + 1); }}>Approve</Button>
              <Button size="xs" variant="ghost" onClick={() => { adminService.markPayoutPaid(row.id, actor, 'reject'); info('Payout rejected', 'The author is notified to check their payout method.'); setRefreshKey((key) => key + 1); }}>Reject</Button>
            </>
          ) : (
            <Badge variant="success" className="text-2xs">settled</Badge>
          )}
        </div>
      ),
    },
  ];

  const pendingTotal = payouts.filter((payout) => payout.status === 'pending').reduce((total, payout) => total + payout.amount, 0);

  return (
    <div>
      <PageHeader title="Revenue" description="Gross sales, platform commission, refunds and author payouts.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={tab === 'overview' ? 'secondary' : 'outline'} onClick={() => setTab('overview')}>Overview</Button>
          <Button size="sm" variant={tab === 'payouts' ? 'secondary' : 'outline'} onClick={() => setTab('payouts')}>Payouts {payouts.filter((payout) => payout.status === 'pending').length > 0 ? `(${payouts.filter((payout) => payout.status === 'pending').length})` : ''}</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const csv = ['date,revenue,fees,refunds,orders', ...series.map((point) => [point.date, point.revenue, point.fees, point.refunds, point.orders].join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `scriptora-revenue-${period}.csv`;
              link.click();
              URL.revokeObjectURL(url);
              success('Revenue report exported');
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export report
          </Button>
        </div>
      </PageHeader>

      <Toolbar>
        <FilterSelect label="Period" value={period} onChange={(value) => setPeriod(value as typeof period)} options={PERIODS} />
        <FilterSelect label="Payment method" value={method} onChange={setMethod} options={[{ value: 'all', label: 'All methods' }, ...summary.byMethod.map((entry) => ({ value: entry.method, label: entry.method.replace('-', ' ') }))]} />
        <span className="text-2xs text-muted-foreground">Net author payable = gross − platform fees − refunds.</span>
      </Toolbar>

      {tab === 'overview' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Gross revenue" value={formatCurrency(summary.gross)} change={`${formatNumber(summary.orders)} orders`} icon={<BadgeDollarSign className="h-4 w-4" />} />
            <StatCard label="Platform fees" value={formatCurrency(summary.fees)} change={`${summary.gross > 0 ? ((summary.fees / summary.gross) * 100).toFixed(1) : 0}% of gross`} icon={<Wallet className="h-4 w-4" />} />
            <StatCard label="Author earnings" value={formatCurrency(summary.authorEarnings)} icon={<Banknote className="h-4 w-4" />} />
            <StatCard label="Refunds" value={formatCurrency(summary.refunds)} change={`${summary.conversion}% completion`} icon={<AlertTriangle className="h-4 w-4" />} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Revenue, fees and refunds</CardTitle>
                <CardDescription className="text-xs">Net revenue over the selected period.</CardDescription>
              </CardHeader>
              <CardContent><RevenueAreaChart data={series} dataKey="revenue" height={260} /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Payment mix</CardTitle></CardHeader>
              <CardContent>
                <DonutChart currency height={220} data={summary.byMethod.map((entry) => ({ name: entry.method.replace('-', ' '), value: entry.revenue }))} />
                <div className="mt-2 space-y-1">
                  {summary.byMethod.map((entry) => (
                    <p key={entry.method} className="flex justify-between text-2xs"><span className="capitalize text-muted-foreground">{entry.method.replace('-', ' ')}</span><span>{entry.orders} orders · {formatCurrency(entry.revenue)}</span></p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Daily fees</CardTitle></CardHeader>
              <CardContent><BarsChart data={series} dataKey="fees" currency height={220} /></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top countries</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {summary.topCountries.map((entry) => (
                  <p key={entry.country} className="flex items-center justify-between border-b py-1 text-xs last:border-0">
                    <span>{entry.country}</span>
                    <span className="font-medium">{formatCurrency(entry.revenue)}</span>
                  </p>
                ))}
                {summary.topCountries.length === 0 && <p className="text-xs text-muted-foreground">No completed sales in this window.</p>}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Commission &amp; thresholds</CardTitle>
              <CardDescription className="text-xs">These values come from Admin → Settings and drive the marketplace maths.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-3">
              <p className="rounded border p-2 text-xs"><span className="block text-2xs text-muted-foreground">Platform commission</span>15% of every sale</p>
              <p className="rounded border p-2 text-xs"><span className="block text-2xs text-muted-foreground">Payout threshold</span>$50 minimum balance</p>
              <p className="rounded border p-2 text-xs"><span className="block text-2xs text-muted-foreground">Schedule</span>Weekly, every Friday</p>
              <Separator className="sm:col-span-3" />
              <p className="text-2xs text-muted-foreground sm:col-span-3">Adjust the fee, threshold and schedule in <Link to="/admin/settings" className="underline">Settings</Link>. Entitlement checks and the author earnings screen both read these values.</p>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Pending payouts" value={formatNumber(payouts.filter((payout) => payout.status === 'pending').length)} icon={<Clock className="h-4 w-4" />} />
            <StatCard label="Pending value" value={formatCurrency(pendingTotal)} icon={<Wallet className="h-4 w-4" />} />
            <StatCard label="Settled" value={formatNumber(payouts.filter((payout) => payout.status === 'paid').length)} icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Requests total" value={formatNumber(payouts.length)} />
          </div>

          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Payout queue</CardTitle>
              <CardDescription className="text-xs">Author requests land here; approving marks the request paid and writes an audit entry.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={payoutColumns}
                rows={payouts}
                emptyState={<EmptyState icon={<Wallet className="h-5 w-5" />} title="No payout requests" description="Authors can request a payout from their earnings page once they pass the threshold." />}
              />
            </CardContent>
          </Card>

          <p className="mt-3 text-2xs text-muted-foreground">Settlements are simulated — the mock provider records the reference and emails the author. Real payouts plug into the Phase 6 payments provider.</p>
        </>
      )}
    </div>
  );
}
