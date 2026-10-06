import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight, ArrowUpRight, Banknote, CalendarClock, CreditCard, Download, Landmark, Loader2, Receipt, RefreshCcw, TrendingUp, Wallet,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { RevenueAreaChart } from '@/components/ui/charts';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useOrders, useRevenueByBook, useRevenueSeries, useRevenueSummary } from '@/hooks/queries';
import { revenueService } from '@/services';
import type { PeriodKey } from '@/services/revenueService';
import { useAuth } from '@/providers/AuthProvider';
import { formatCurrency, formatDate, formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Order, PayoutMethod } from '@/types/domain';
import type { BookAnalytics } from '@/services/analyticsService';

export default function EarningsPage() {
  const { user } = useAuth();
  const { success, error } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [period, setPeriod] = React.useState<PeriodKey>('30d');
  const [methodOpen, setMethodOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PayoutMethod>(user?.payoutMethod ?? { type: 'bank', label: 'Bank transfer', last4: '4417', country: 'United States', ready: true });

  const { data: summary } = useRevenueSummary(user?.id, period);
  const { data: series } = useRevenueSeries(user?.id, period, 'revenue');
  const { data: byBook } = useRevenueByBook(user?.id, period);
  const { data: orders } = useOrders(user?.id);

  const payout = user ? revenueService.payoutSummary(user.id) : undefined;
  const history = user ? revenueService.payoutHistory(user.id) : [];
  const buyers = user ? revenueService.topBuyers(user.id, 6) : [];
  const [payoutRecord, setPayoutRecord] = React.useState<{ reference: string; amount: number; scheduledFor: string } | null>(null);

  const requestPayout = useMutation({
    mutationFn: () => revenueService.requestPayout(user?.id as string),
    onSuccess: (record) => {
      setPayoutRecord(record);
      qc.invalidateQueries({ queryKey: ['activity'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      success('Payout requested', `${formatCurrency(record.amount)} should arrive by ${formatDate(record.scheduledFor)}.`);
    },
    onError: (e: Error) => error('Payout not available', e.message),
  });

  const refund = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => revenueService.refundOrder(orderId, reason, user?.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['revenue'] }); success('Order refunded', 'The reader has been credited and the revenue adjusted.'); },
    onError: (e: Error) => error('Refund failed', e.message),
  });

  const orderColumns: Column<Order>[] = [
    { key: 'number', header: 'Order', width: '120px', render: (row) => <span className="font-mono text-xs">{row.number}</span> },
    { key: 'book', header: 'Book', render: (row) => <span className="truncate text-sm">{row.bookTitle}</span> },
    { key: 'buyer', header: 'Buyer', render: (row) => <span className="text-sm">{row.buyerName}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'fee', header: 'Fee', align: 'right', render: (row) => <span className="text-muted-foreground">{formatCurrency(row.platformFee)}</span> },
    { key: 'earnings', header: 'You earn', align: 'right', render: (row) => <span className="font-medium">{formatCurrency(row.authorEarnings)}</span> },
    { key: 'country', header: 'Country', width: '150px', render: (row) => <span className="text-xs text-muted-foreground">{row.country}</span> },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (row) => <Badge variant={row.status === 'completed' ? 'success' : row.status === 'refunded' ? 'danger' : 'warning'}>{row.status}</Badge>,
    },
    { key: 'date', header: 'Date', width: '140px', render: (row) => <span className="text-xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="xs"
          disabled={row.status !== 'completed'}
          onClick={async () => {
            const ok = await confirm({
              title: `Refund order ${row.number}?`,
              description: `${formatCurrency(row.amount)} will be returned to ${row.buyerName} and removed from your earnings.`,
              confirmLabel: 'Issue refund',
              destructive: true,
            });
            if (ok) refund.mutate({ orderId: row.id, reason: 'Author-initiated goodwill refund' });
          }}
        >
          <RefreshCcw className="h-3 w-3" /> Refund
        </Button>
      ),
    },
  ];

  const bookColumns: Column<BookAnalytics>[] = [
    { key: 'title', header: 'Book', render: (row) => <span className="truncate text-sm font-medium">{row.title}</span> },
    { key: 'sales', header: 'Sales', align: 'right', sortable: true, render: (row) => formatNumber(row.sales) },
    { key: 'revenue', header: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
    { key: 'rating', header: 'Rating', align: 'right', render: (row) => row.rating ? row.rating.toFixed(2) : '—' },
    { key: 'downloads', header: 'Downloads', align: 'right', render: (row) => formatNumber(row.downloads) },
  ];

  if (!orders || orders.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="h-5 w-5" />}
        title="No earnings yet"
        description="Publish a book to the marketplace and your sales, payouts and buyer insights land here."
        actions={<Button onClick={() => navigate('/dashboard/publishing')}>Open publishing centre</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Earnings</h1>
          <p className="text-sm text-muted-foreground">Sales, platform fees, payouts and the buyers behind them.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={period} onChange={(event) => setPeriod(event.target.value as PeriodKey)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Period">
            {revenueService.periods.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => setMethodOpen(true)}>
            <CreditCard className="h-4 w-4" /> Payout method
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card className="border-l-4 border-l-primary">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Available balance</CardTitle>
            <CardDescription>{payout ? `Payout threshold ${formatCurrency(payout.threshold)} · ${payout.schedule}` : ''}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-3xl font-semibold tracking-tight">{formatCurrency(payout?.available ?? 0)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Ready to withdraw</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-muted-foreground">{formatCurrency(payout?.pending ?? 0)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Pending clearance</p>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-brand-gradient"
                style={{ width: `${Math.min(100, ((payout?.available ?? 0) / Math.max(1, payout?.threshold ?? 1)) * 100)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => requestPayout.mutate()} disabled={requestPayout.isPending || !payout?.eligible}>
                {requestPayout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />} Request payout
              </Button>
              {!payout?.eligible && (
                <p className="text-xs text-muted-foreground">
                  {payout && payout.available < payout.threshold
                    ? `Reach ${formatCurrency(payout.threshold)} to withdraw.`
                    : 'Add a verified payout method to withdraw.'}
                </p>
              )}
              {payoutRecord && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Payout {payoutRecord.reference} scheduled for {formatDate(payoutRecord.scheduledFor)}.
                </p>
              )}
            </div>
            <Separator />
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Payout method</p>
                <p className="text-sm font-medium">{payout?.method ? `${payout.method.label} ${payout.method.last4 ? `••••${payout.method.last4}` : ''}` : 'Not set'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Lifetime earnings</p>
                <p className="text-sm font-medium">{formatCurrency(summary?.lifetimeRevenue ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Platform fees paid</p>
                <p className="text-sm font-medium">{formatCurrency(summary?.platformFees ?? 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Revenue trend</CardTitle>
            <CardDescription>Net author earnings</CardDescription>
          </CardHeader>
          <CardContent>
            <RevenueAreaChart data={(series ?? []).map((point) => ({ label: point.label, value: point.value }))} height={220} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net earnings" value={formatCurrency(summary?.netEarnings ?? 0)} change={summary ? `${summary.changePct.revenue > 0 ? '+' : ''}${summary.changePct.revenue}%` : undefined} hint={revenueService.periods.find((entry) => entry.key === period)?.label} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
        <StatCard label="Gross sales" value={formatCurrency(summary?.totalRevenue ?? 0)} hint={`${formatNumber(summary?.totalSales ?? 0)} orders`} icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Refunds" value={formatNumber(summary?.refunds ?? 0)} hint="Returned to readers" icon={<ArrowDownRight className="h-4 w-4" />} tone={summary?.refunds ? 'warning' : 'default'} />
        <StatCard label="Avg. order" value={formatCurrency((summary?.totalSales ?? 0) > 0 ? (summary?.totalRevenue ?? 0) / (summary?.totalSales ?? 1) : 0)} hint="Per completed sale" icon={<ArrowUpRight className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue by title</CardTitle>
            <CardDescription>Which books are carrying your catalogue.</CardDescription>
          </CardHeader>
          <CardContent>
            {(byBook ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales in this period.</p>
            ) : (
              <DataTable columns={bookColumns} rows={(byBook ?? []).map((row) => ({ ...row, id: row.bookId }))} rowKey={(row) => row.bookId} dense />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top buyers</CardTitle>
              <CardDescription>Your most loyal readers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {buyers.length === 0 && <p className="text-sm text-muted-foreground">No repeat buyers yet.</p>}
              {buyers.map((buyer) => (
                <div key={buyer.userId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{buyer.name}</p>
                    <p className="text-xs text-muted-foreground">{buyer.orders} orders · {buyer.country} · last {timeAgo(buyer.lastOrder)}</p>
                  </div>
                  <span className="shrink-0 text-sm font-medium">{formatCurrency(buyer.spend)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payout history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 && <p className="text-sm text-muted-foreground">No payouts requested yet.</p>}
              {history.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{formatCurrency(entry.amount)}</span>
                    <Badge variant="success">Requested</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Orders</CardTitle>
            <CardDescription>Every sale, pending charge and refund across your titles.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => success('Statement queued', 'A CSV statement will appear in your export history.')}>
            <Download className="h-4 w-4" /> Download statement
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable columns={orderColumns} rows={orders} rowKey={(row) => row.id} dense />
        </CardContent>
      </Card>

      <Modal
        open={methodOpen}
        onOpenChange={setMethodOpen}
        title="Payout method"
        description="Where your earnings are sent. In the mock environment this only stores details locally."
        footer={
          <>
            <Button variant="outline" onClick={() => setMethodOpen(false)}>Cancel</Button>
            <Button onClick={() => { success('Payout method saved'); setMethodOpen(false); }}>Save method</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['bank', 'paypal', 'stripe'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMethod((current) => ({ ...current, type, label: type === 'bank' ? 'Bank transfer' : type === 'paypal' ? 'PayPal' : 'Stripe Connect' }))}
                className={cn('rounded-lg border p-3 text-left capitalize transition-colors', method.type === type ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <p className="text-sm font-medium">{type === 'bank' ? 'Bank transfer' : type === 'paypal' ? 'PayPal' : 'Stripe'}</p>
                <p className="text-xs text-muted-foreground">{type === 'bank' ? '2–3 business days' : 'Instant'}</p>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="payout-country">Country</label>
              <select id="payout-country" value={method.country} onChange={(event) => setMethod((current) => ({ ...current, country: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                {['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'Spain'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="payout-last4">Account ending</label>
              <input id="payout-last4" value={method.last4 ?? ''} onChange={(event) => setMethod((current) => ({ ...current, last4: event.target.value.slice(0, 4) }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <CalendarClock className="mr-1 inline h-3 w-3" /> Payouts run weekly on Fridays once your balance clears the threshold.
          </div>
        </div>
      </Modal>
    </div>
  );
}
