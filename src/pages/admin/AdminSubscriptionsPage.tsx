import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CreditCard, RefreshCcw, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { DropdownMenu, useConfirm, type MenuItemDef } from '@/components/ui/overlays';
import { BarsChart, DonutChart } from '@/components/ui/charts';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminOverview, useInvoices, usePlans, keys } from '@/hooks/queries';
import { subscriptionService, emailService } from '@/services';
import { formatCurrency, formatDate, formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterSelect, StatusPill, Toolbar } from './shared';
import type { Invoice, Plan, Subscription } from '@/types/domain';

type Row = Subscription & { userName: string; email: string; planName: string; mrr: number };

export default function AdminSubscriptionsPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: overview } = useAdminOverview();
  const { data: plans } = usePlans();
  const [planFilter, setPlanFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [tab, setTab] = React.useState<'subscriptions' | 'invoices'>('subscriptions');

  const allInvoices = useInvoices(undefined);
  const invoiceRefresh = () => void allInvoices.refetch?.();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(() => {
    setLoading(true);
    // Admin view: read every subscription through the service, then join the account.
    const list = subscriptionService.adminSubscriptions();
    setRows(list);
    setLoading(false);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const changePlan = useAdminAction(
    ({ userId, planId }: { userId: string; planId: string }) => subscriptionService.changePlan(userId, planId),
    { success: 'Subscription updated', detail: 'An invoice was generated for the new plan.', invalidate: [keys.adminOverview, keys.plans] },
  );

  const filtered = rows.filter((row) => (planFilter === 'all' || row.planId === planFilter) && (statusFilter === 'all' || row.status === statusFilter));

  const columns: Column<Row>[] = [
    {
      key: 'user',
      header: 'Subscriber',
      render: (row) => (
        <div className="min-w-0">
          <Link to={`/admin/users/${row.userId}`} className="truncate text-xs font-medium hover:underline">{row.userName}</Link>
          <p className="truncate text-2xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', render: (row) => <Badge variant="outline" className="text-2xs">{row.planName}</Badge> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'interval', header: 'Billing', render: (row) => <span className="text-2xs capitalize">{row.interval}</span> },
    { key: 'seats', header: 'Seats', align: 'right', render: (row) => formatNumber(row.seats) },
    { key: 'mrr', header: 'MRR', align: 'right', sortable: true, render: (row) => formatCurrency(row.mrr) },
    { key: 'renewsAt', header: 'Renews', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{row.canceledAt ? 'canceled' : formatDate(row.renewsAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <DropdownMenu
          align="end"
          trigger={<Button size="xs" variant="ghost">Manage</Button>}
          items={[
            { id: 'open', label: 'Open subscriber', onSelect: () => { window.location.assign(`/admin/users/${row.userId}`); } },
            ...(plans ?? []).map((plan) => ({ id: `plan-${plan.id}`, label: `Move to ${plan.name}`, onSelect: () => changePlan.mutate({ userId: row.userId, planId: plan.id }) })),
            { id: 'divider', label: '', divider: true },
            { id: 'extend', label: 'Extend 30 days', onSelect: () => { subscriptionService.extend(row.id, 30); success('Renewal extended by 30 days'); load(); } },
            { id: 'resume', label: 'Resume billing', onSelect: () => { void subscriptionService.resume(row.userId).then(() => { success('Billing resumed'); load(); }); } },
            { id: 'cancel', label: 'Cancel subscription', destructive: true, onSelect: async () => { const ok = await confirm({ title: `Cancel ${row.userName}'s subscription?`, description: 'They keep access until the end of the paid period, then drop to Free.', destructive: true, confirmLabel: 'Cancel subscription' }); if (ok) { await subscriptionService.cancel(row.userId, `Cancelled by ${actor.name}`); success('Subscription cancelled'); load(); } } },
            { id: 'refund', label: 'Issue refund', onSelect: () => { void subscriptionService.refundLatest(row.userId, actor).then((invoice) => { if (invoice) { success('Refund issued', `${formatCurrency(invoice.amount)} refunded`); load(); } else info('No paid invoice to refund'); }); } },
          ] as MenuItemDef[]}
        />
      ),
    },
  ];

  const invoiceRows = (allInvoices.data ?? []) as Invoice[];
  const invoiceColumns: Column<Invoice>[] = [
    { key: 'id', header: 'Invoice', render: (row) => <span className="font-mono text-2xs">{row.id}</span> },
    { key: 'plan', header: 'Plan', render: (row) => <span className="text-xs">{row.planName}</span> },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (row) => formatCurrency(row.amount) },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'createdAt', header: 'Issued', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => void emailService.send({ to: row.userId, toName: 'Customer', template: 'system', meta: `Invoice ${row.id}` }).then(() => success('Invoice emailed'))}>Resend</Button>
          {row.status !== 'refunded' && <Button size="xs" variant="ghost" onClick={() => { void subscriptionService.refundInvoice(row.id, actor).then(() => { success('Invoice refunded'); invoiceRefresh(); }); }}>Refund</Button>}
        </div>
      ),
    },
  ];

  const stats = overview?.subscriptions;

  return (
    <div>
      <PageHeader title="Subscriptions" description="Recurring revenue, plan movement and billing health across every account.">
        <div className="flex gap-1.5">
          <Button size="sm" variant={tab === 'subscriptions' ? 'secondary' : 'outline'} onClick={() => setTab('subscriptions')}>Subscriptions</Button>
          <Button size="sm" variant={tab === 'invoices' ? 'secondary' : 'outline'} onClick={() => setTab('invoices')}>Invoices</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="MRR" value={formatCurrency(stats?.mrr ?? 0)} change={`${formatCurrency(stats?.arr ?? 0)} ARR`} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="Active" value={formatNumber(stats?.active ?? 0)} change={`${stats?.pastDue ?? 0} past due`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Churn" value={`${stats?.churnRate ?? 0}%`} change="monthly" icon={<TrendingDown className="h-4 w-4" />} />
        <StatCard label="Trial conversion" value={`${stats?.trialConversion ?? 0}%`} icon={<TrendingUp className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">MRR by plan</CardTitle></CardHeader>
          <CardContent><BarsChart data={(stats?.byPlan ?? []).map((entry) => ({ label: entry.plan.name, revenue: entry.mrr }))} dataKey="revenue" currency height={220} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Subscriber mix</CardTitle></CardHeader>
          <CardContent><DonutChart height={220} data={(stats?.byPlan ?? []).map((entry) => ({ name: entry.plan.name, value: entry.subscribers }))} /></CardContent>
        </Card>
      </div>

      <Toolbar className="mt-4">
        <FilterSelect label="Plan" value={planFilter} onChange={setPlanFilter} options={[{ value: 'all', label: 'All plans' }, ...(plans ?? []).map((plan) => ({ value: plan.id, label: plan.name }))]} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'trialing', label: 'Trialing' }, { value: 'past_due', label: 'Past due' }, { value: 'canceled', label: 'Canceled' }]} />
        <Button size="sm" variant="outline" onClick={load}><RefreshCcw className="h-3.5 w-3.5" /> Refresh</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const pastDue = rows.filter((row) => row.status === 'past_due');
            const ok = await confirm({ title: `Retry ${pastDue.length} failed payment(s)?`, description: 'A dunning email is sent after each retry attempt.', confirmLabel: 'Retry payments' });
            if (!ok) return;
            pastDue.forEach((row) => void emailService.send({ to: row.email, toName: row.userName, template: 'subscription' }));
            success(`${pastDue.length} payment retries queued`);
          }}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Retry failed payments ({rows.filter((row) => row.status === 'past_due').length})
        </Button>
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          {tab === 'subscriptions' ? (
            <DataTable
              columns={columns}
              rows={filtered}
              loading={loading}
              emptyState={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No subscriptions match" description="Change the filters to see more subscribers." />}
            />
          ) : (
            <DataTable
              columns={invoiceColumns}
              rows={invoiceRows}
              loading={allInvoices.isLoading}
              emptyState={<EmptyState icon={<CreditCard className="h-5 w-5" />} title="No invoices yet" description="Invoices appear when plans change or renew." />}
            />
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Plan catalogue</CardTitle>
          <CardDescription className="text-xs">Pricing is edited in Admin → Plans; those numbers drive entitlements everywhere in the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(plans ?? []).map((plan: Plan) => (
            <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
              <span className="font-medium">{plan.name} {!plan.active && <Badge variant="warning" className="ml-1 text-2xs">inactive</Badge>}</span>
              <span className="text-muted-foreground">{formatCurrency(plan.priceMonthly)}/mo · {formatCurrency(plan.priceYearly)}/yr · {plan.features.aiCredits} AI credits · {plan.features.maxBooks === -1 ? 'unlimited' : plan.features.maxBooks} books</span>
              <Link to="/admin/plans" className="rounded border px-2 py-0.5 text-2xs hover:bg-muted">Edit</Link>
            </div>
          ))}
          <Separator />
          <p className="text-2xs text-muted-foreground">Cancellations keep access until the end of the paid period; refunds are recorded against the invoice.</p>
        </CardContent>
      </Card>
    </div>
  );
}
