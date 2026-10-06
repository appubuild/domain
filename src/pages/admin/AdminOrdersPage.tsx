import * as React from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Download, RefreshCcw, RotateCcw, ShoppingCart } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterInput, FilterSelect, StatusPill, Toolbar } from './shared';
import type { Order } from '@/types/domain';

type Row = Order & { buyerEmail: string };

export default function AdminOrdersPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [method, setMethod] = React.useState('all');
  const [sort, setSort] = React.useState<'recent' | 'amount' | 'fee'>('recent');
  const [detail, setDetail] = React.useState<Row | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [orders, setOrders] = React.useState<Row[]>([]);

  const reload = React.useCallback(() => {
    setOrders(adminService.orders({ query: query || undefined, status, method, sort }) as Row[]);
  }, [method, query, sort, status]);

  React.useEffect(() => { reload(); }, [reload]);

  const refund = useAdminAction(
    ({ orderId, reason }: { orderId: string; reason: string }) => adminService.refundOrder(orderId, reason, actor),
    { success: 'Order refunded', detail: 'The buyer is emailed and the audit log updated.', invalidate: [keys.adminOverview] },
  );

  const completed = orders.filter((order) => order.status === 'completed');
  const gross = completed.reduce((total, order) => total + order.amount, 0);
  const fees = completed.reduce((total, order) => total + order.platformFee, 0);
  const refundTotal = orders.filter((order) => order.status === 'refunded').reduce((total, order) => total + order.amount, 0);

  const columns: Column<Row>[] = [
    { key: 'number', header: 'Order', render: (row) => <span className="font-mono text-2xs">{row.number}</span> },
    {
      key: 'book',
      header: 'Book',
      render: (row) => (
        <div className="min-w-0">
          <Link to={`/dashboard/books/${row.bookId}`} className="truncate text-xs font-medium hover:underline">{row.bookTitle}</Link>
          <p className="truncate text-2xs text-muted-foreground">by {row.authorName}</p>
        </div>
      ),
    },
    {
      key: 'buyer',
      header: 'Buyer',
      render: (row) => (
        <div className="min-w-0">
          <Link to={`/admin/users/${row.buyerId}`} className="truncate text-xs hover:underline">{row.buyerName}</Link>
          <p className="truncate text-2xs text-muted-foreground">{row.buyerEmail}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'platformFee', header: 'Platform fee', align: 'right', sortable: true, render: (row) => formatCurrency(row.platformFee) },
    { key: 'authorEarnings', header: 'Author', align: 'right', render: (row) => formatCurrency(row.authorEarnings) },
    { key: 'method', header: 'Method', render: (row) => <span className="text-2xs capitalize">{row.method.replace('-', ' ')}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'createdAt', header: 'Placed', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setDetail(row)}>View</Button>
          {row.status === 'completed' && (
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm({ title: `Refund ${row.number}?`, description: `${formatCurrency(row.amount)} goes back to ${row.buyerName}. The author earnings are reversed.`, destructive: true, confirmLabel: 'Refund order' });
                if (!ok) return;
                refund.mutate({ orderId: row.id, reason: `Refunded by ${actor.name}` });
                setTimeout(reload, 400);
              }}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Orders" description="Every marketplace transaction, with refunds, fee breakdown and buyer details.">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const csv = ['order,book,author,buyer,amount,fee,author_earnings,method,status,date', ...orders.map((order) => [order.number, order.bookTitle, order.authorName, order.buyerName, order.amount, order.platformFee, order.authorEarnings, order.method, order.status, order.createdAt].join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'scriptora-orders.csv';
              link.click();
              URL.revokeObjectURL(url);
              success('Orders exported', `${orders.length} rows`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export orders
          </Button>
          <Button size="sm" variant="ghost" onClick={reload}><RefreshCcw className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Orders" value={formatNumber(orders.length)} change={`${completed.length} completed`} icon={<ShoppingCart className="h-4 w-4" />} />
        <StatCard label="Gross" value={formatCurrency(gross)} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="Platform fees" value={formatCurrency(fees)} change={`${gross > 0 ? ((fees / gross) * 100).toFixed(1) : 0}% take rate`} />
        <StatCard label="Refunded" value={formatCurrency(refundTotal)} change={`${orders.filter((order) => order.status === 'refunded').length} refunds`} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search orders" value={query} onChange={setQuery} placeholder="Search order, book, buyer or author" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'pending', label: 'Pending' }, { value: 'refunded', label: 'Refunded' }, { value: 'failed', label: 'Failed' }]} />
        <FilterSelect label="Method" value={method} onChange={setMethod} options={[{ value: 'all', label: 'All methods' }, { value: 'card', label: 'Card' }, { value: 'paypal', label: 'PayPal' }, { value: 'apple-pay', label: 'Apple Pay' }, { value: 'credits', label: 'Credits' }]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'recent', label: 'Newest' }, { value: 'amount', label: 'Highest value' }, { value: 'fee', label: 'Highest fee' }]} />
      </Toolbar>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <span className="text-xs font-medium">{selected.length} selected</span>
          <Button
            size="xs"
            variant="outline"
            onClick={async () => {
              const ok = await confirm({ title: `Refund ${selected.length} order(s)?`, description: 'Buyers are emailed and author earnings reversed.', destructive: true, confirmLabel: 'Refund selected' });
              if (!ok) return;
              for (const orderId of selected) await adminService.refundOrder(orderId, `Bulk refund by ${actor.name}`, actor);
              success(`${selected.length} orders refunded`);
              setSelected([]);
              reload();
            }}
          >
            <RotateCcw className="h-3 w-3" /> Bulk refund
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={orders}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            emptyState={<EmptyState icon={<ShoppingCart className="h-5 w-5" />} title="No orders match" description="Try a different status or clear the search." />}
          />
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => !next && setDetail(null)}
        title={detail ? `Order ${detail.number}` : 'Order'}
        description={detail ? `${formatCurrency(detail.amount)} · ${formatDateTime(detail.createdAt)} · ${detail.country}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail?.status === 'completed' && (
              <Button
                onClick={async () => {
                  const ok = await confirm({ title: 'Refund this order?', description: 'This cannot be undone.', destructive: true, confirmLabel: 'Refund' });
                  if (ok && detail) { refund.mutate({ orderId: detail.id, reason: `Refunded by ${actor.name}` }); setDetail(null); setTimeout(reload, 400); }
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Refund
              </Button>
            )}
          </>
        }
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Book" value={detail.bookTitle} />
              <Field label="Author" value={detail.authorName} />
              <Field label="Buyer" value={`${detail.buyerName} (${detail.buyerEmail})`} />
              <Field label="Payment method" value={detail.method.replace('-', ' ')} />
              <Field label="Amount" value={formatCurrency(detail.amount)} />
              <Field label="Platform fee" value={formatCurrency(detail.platformFee)} />
              <Field label="Author earnings" value={formatCurrency(detail.authorEarnings)} />
              <Field label="Status" value={detail.status} />
            </div>
            {detail.refundReason && <p className="rounded bg-destructive/10 p-2 text-destructive">Refund reason: {detail.refundReason}</p>}
            <Separator />
            <p className="text-2xs text-muted-foreground">Order IDs are deterministic seeds; in production this record would come from the payments provider webhook.</p>
          </div>
        )}
      </Modal>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Payment methods</CardTitle>
          <CardDescription className="text-xs">Mix of completed transactions in this filtered set.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['card', 'paypal', 'apple-pay', 'credits'].map((entry) => (
            <Badge key={entry} variant="outline" className="text-2xs">{entry.replace('-', ' ')}: {orders.filter((order) => order.method === entry).length}</Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-start justify-between gap-3 border-b py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value}</span>
    </p>
  );
}
