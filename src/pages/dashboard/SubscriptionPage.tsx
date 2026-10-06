import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, Check, CreditCard, Crown, Download, Loader2, Receipt, RefreshCcw, Sparkles, Undo2, X,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, UsageMeter, type Column } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useInvoices, usePlans } from '@/hooks/queries';
import { subscriptionService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatCurrency, formatDate, formatNumber, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Invoice, Plan } from '@/types/domain';

export default function SubscriptionPage() {
  const { user, entitlements, refresh } = useAuth();
  const { success, error, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: plans } = usePlans();
  const { data: invoices } = useInvoices(user?.id);
  const current = user ? subscriptionService.current(user.id) : undefined;
  const usage = user ? subscriptionService.usage(user.id) : undefined;
  const comparison = subscriptionService.comparison();
  const [interval, setInterval] = React.useState<'monthly' | 'yearly'>('monthly');
  const [changing, setChanging] = React.useState<Plan | null>(null);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('Too expensive right now');

  const activePlans = React.useMemo(() => (plans ?? []).filter((plan) => plan.active).sort((a, b) => a.order - b.order), [plans]);

  const changePlan = useMutation({
    mutationFn: (planId: string) => subscriptionService.changePlan(user?.id as string, planId, interval),
    onSuccess: (result) => {
      qc.invalidateQueries();
      refresh();
      setChanging(null);
      success(`Now on ${result.plan.name}`, result.invoice ? `Invoice ${result.invoice.number} created for ${formatCurrency(result.invoice.amount)}.` : 'Your plan is updated.');
    },
    onError: (e: Error) => error('Could not change plan', e.message),
  });

  const cancel = useMutation({
    mutationFn: () => subscriptionService.cancel(user?.id as string, cancelReason),
    onSuccess: () => {
      qc.invalidateQueries();
      refresh();
      setCancelOpen(false);
      info('Subscription cancelled', 'You keep premium features until the end of the billing period.');
    },
    onError: (e: Error) => error('Could not cancel', e.message),
  });

  const resume = useMutation({
    mutationFn: () => subscriptionService.resume(user?.id as string),
    onSuccess: () => { qc.invalidateQueries(); refresh(); success('Subscription resumed'); },
    onError: (e: Error) => error('Could not resume', e.message),
  });

  const columns: Column<Invoice & { id: string }>[] = [
    { key: 'number', header: 'Invoice', width: '120px', render: (row) => <span className="font-mono text-xs">{row.number}</span> },
    { key: 'plan', header: 'Plan', render: (row) => <span className="text-sm">{row.planName}</span> },
    { key: 'period', header: 'Period', render: (row) => <span className="text-xs text-muted-foreground">{formatDate(row.periodStart)} → {formatDate(row.periodEnd)}</span> },
    { key: 'interval', header: 'Billing', width: '100px', render: (row) => <Badge variant="outline" className="capitalize">{row.interval}</Badge> },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => formatCurrency(row.amount) },
    { key: 'status', header: 'Status', width: '110px', render: (row) => <Badge variant={row.status === 'paid' ? 'success' : row.status === 'refunded' ? 'danger' : 'warning'}>{row.status}</Badge> },
    { key: 'created', header: 'Date', width: '130px', render: (row) => <span className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      render: (row) => (
        <Button variant="ghost" size="xs" onClick={() => success('Invoice downloaded', `${row.number} saved as PDF`)}>
          <Download className="h-3 w-3" /> PDF
        </Button>
      ),
    },
  ];

  const plan = current?.plan ?? entitlements.plan;
  const subscription = current?.subscription;
  const yearlySaving = Math.round((1 - plan.priceYearly / Math.max(1, plan.priceMonthly * 12)) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Subscription</h1>
          <p className="text-sm text-muted-foreground">Your plan, usage against limits, and everything you have been billed.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(['monthly', 'yearly'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setInterval(entry)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors', interval === entry ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              aria-pressed={interval === entry}
            >
              {entry}{entry === 'yearly' && yearlySaving > 0 ? ` · save ${yearlySaving}%` : ''}
            </button>
          ))}
        </div>
      </div>

      <Card className="border-l-4 border-l-primary">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-brand-gradient p-3 text-white">
              {plan.id === 'plan_business' ? <Crown className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{plan.name}</p>
                {plan.badge && <Badge variant="accent">{plan.badge}</Badge>}
                <Badge variant={subscription?.status === 'active' ? 'success' : subscription?.status === 'canceled' ? 'danger' : 'warning'}>
                  {subscription?.status ?? 'free'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{plan.tagline}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {subscription
                  ? `${formatCurrency(subscription.interval === 'yearly' ? plan.priceYearly : plan.priceMonthly)} · ${subscription.interval} · ${subscription.status === 'canceled' ? 'ends' : 'renews'} ${formatDate(subscription.renewsAt)}`
                  : 'No billing — you are on the free plan forever.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {subscription?.status === 'canceled' ? (
              <Button onClick={() => resume.mutate()} disabled={resume.isPending}>
                {resume.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Resume subscription
              </Button>
            ) : (
              <>
                {plan.id !== 'plan_business' && (
                  <Button onClick={() => { const next = activePlans.find((entry) => entry.order === plan.order + 1); if (next) setChanging(next); }}>
                    <Sparkles className="h-4 w-4" /> Upgrade
                  </Button>
                )}
                {plan.id !== 'plan_free' && (
                  <Button variant="outline" onClick={() => setCancelOpen(true)}>Cancel plan</Button>
                )}
              </>
            )}
            <Button variant="ghost" onClick={() => navigate('/pricing')}>Compare all plans</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Book projects" value={`${usage?.books.used ?? 0} / ${usage?.books.unlimited ? '∞' : usage?.books.limit ?? 0}`} hint={usage?.books.unlimited ? 'Unlimited on your plan' : `${Math.max(0, (usage?.books.limit ?? 0) - (usage?.books.used ?? 0))} remaining`} icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Storage" value={`${((usage?.storage.usedBytes ?? 0) / 1024 / 1024 / 1024).toFixed(2)} GB`} hint={`of ${((usage?.storage.limitBytes ?? 0) / 1024 / 1024 / 1024).toFixed(0)} GB`} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="AI credits" value={`${formatNumber(usage?.aiCredits.used ?? 0)} / ${formatNumber(usage?.aiCredits.limit ?? 0)}`} hint="Resets each period" icon={<Sparkles className="h-4 w-4" />} />
        <StatCard label="Team seats" value={`${usage?.seats.used ?? 0} / ${usage?.seats.limit ?? 0}`} hint={plan.features.collaboration ? 'Collaboration included' : 'Single author'} icon={<BadgeCheck className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Usage this period</CardTitle>
            <CardDescription>Limits come from your plan record, so admin changes apply instantly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeter label="Book projects" used={usage?.books.used ?? 0} limit={usage?.books.unlimited ? Math.max(1, usage?.books.used ?? 1) : usage?.books.limit ?? 1} format={(value) => (usage?.books.unlimited ? 'Unlimited' : String(value))} />
            <UsageMeter label="Storage" used={usage?.storage.usedBytes ?? 0} limit={usage?.storage.limitBytes ?? 1} format={(value) => `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`} tone={usage && usage.storage.percent > 85 ? 'warning' : 'primary'} />
            <UsageMeter label="AI writing credits" used={usage?.aiCredits.used ?? 0} limit={usage?.aiCredits.limit ?? 1} tone={usage && usage.aiCredits.percent > 85 ? 'warning' : 'primary'} />
            <UsageMeter label="AI image credits" used={usage?.aiImages.used ?? 0} limit={usage?.aiImages.limit ?? 1} tone={usage && usage.aiImages.percent > 85 ? 'warning' : 'primary'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What your plan unlocks</CardTitle>
            <CardDescription>{plan.name} · {plan.features.support} support</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: `${plan.features.maxBooks < 0 ? 'Unlimited' : plan.features.maxBooks} book projects`, on: true },
              { label: `${plan.features.storageGb} GB asset storage`, on: true },
              { label: `${formatNumber(plan.features.aiCredits)} AI writing credits / month`, on: true },
              { label: `${plan.features.exportFormats.length} export formats`, on: true },
              { label: 'Premium templates', on: plan.features.premiumTemplates },
              { label: 'AI image & cover generation', on: plan.features.aiImageGeneration },
              { label: 'Marketplace selling', on: plan.features.marketplaceSelling },
              { label: 'Collaboration', on: plan.features.collaboration },
              { label: 'Print publishing profiles', on: plan.features.printProfiles },
              { label: 'Custom author domain', on: plan.features.customDomain },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-sm">
                {row.on ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-muted-foreground/40" />}
                <span className={row.on ? '' : 'text-muted-foreground'}>{row.label}</span>
              </div>
            ))}
            <Separator />
            <p className="text-xs text-muted-foreground">
              Marketplace commission on your plan: {Math.round(plan.commissionRate * 100)}%. You keep {Math.round((1 - plan.commissionRate) * 100)}% of every sale.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
          <CardDescription>Prices in USD. Cancel or change at any time — changes apply immediately in the mock billing engine.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-3">
            {activePlans.map((entry) => {
              const isCurrent = entry.id === plan.id;
              const price = interval === 'yearly' ? entry.priceYearly : entry.priceMonthly;
              return (
                <div key={entry.id} className={cn('flex flex-col rounded-xl border p-4', isCurrent ? 'border-primary ring-1 ring-primary' : entry.highlight ? 'border-primary/40' : '')}>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{entry.name}</p>
                    {entry.badge && <Badge variant="accent" className="text-2xs">{entry.badge}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{entry.tagline}</p>
                  <p className="mt-3 text-2xl font-semibold">
                    {price === 0 ? 'Free' : formatCurrency(price)}
                    {price > 0 && <span className="text-sm font-normal text-muted-foreground">/{interval === 'yearly' ? 'yr' : 'mo'}</span>}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1.5 text-xs">
                    {entry.marketingFeatures.slice(0, 6).map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent || !entry.purchasable}
                    onClick={() => setChanging(entry)}
                  >
                    {isCurrent ? 'Current plan' : !entry.purchasable ? 'Not available' : `Switch to ${entry.name}`}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Billing history</CardTitle>
          <CardDescription>Every invoice generated for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {(invoices ?? []).length === 0 ? (
            <EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices yet" description="Invoices appear here after your first paid subscription period." />
          ) : (
            <DataTable columns={columns} rows={(invoices ?? []).map((invoice) => ({ ...invoice, id: invoice.id }))} rowKey={(row) => row.id} dense />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Feature comparison</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Feature</th>
                {comparison.plans.map((entry) => <th key={entry.id} className="pb-2 text-center font-medium">{entry.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-2 text-xs text-muted-foreground">{row.label}</td>
                  {row.values.map((value, index) => (
                    <td key={index} className={cn('py-2 text-center text-xs', value === '—' ? 'text-muted-foreground/50' : 'font-medium')}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(changing)}
        onOpenChange={(open) => !open && setChanging(null)}
        title={changing ? `Switch to ${changing.name}` : 'Change plan'}
        description="Simulated billing — no card is charged. An invoice is generated for the record."
        footer={
          <>
            <Button variant="outline" onClick={() => setChanging(null)}>Cancel</Button>
            <Button onClick={() => changing && changePlan.mutate(changing.id)} disabled={changePlan.isPending}>
              {changePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirm {interval === 'yearly' ? 'annual' : 'monthly'} plan
            </Button>
          </>
        }
      >
        {changing && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">New plan</span><span className="font-medium">{changing.name}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Billing period</span><span className="font-medium capitalize">{interval}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Amount due today</span><span className="font-medium">{formatCurrency(interval === 'yearly' ? changing.priceYearly : changing.priceMonthly)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Unlocks</span><span className="font-medium">{changing.features.maxBooks < 0 ? 'Unlimited books' : `${changing.features.maxBooks} books`}, {formatNumber(changing.features.aiCredits)} AI credits</span></div>
            {plan.priceMonthly > changing.priceMonthly && (
              <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                Downgrading to {changing.name} removes features immediately, including {plan.features.marketplaceSelling && !changing.features.marketplaceSelling ? 'marketplace selling' : 'premium exports'}. Your existing books are never deleted.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel your subscription"
        description="Your premium features stay active until the end of the current billing period."
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              <Undo2 className="h-4 w-4" /> Keep my plan
            </Button>
            <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} Cancel subscription
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Before you go, tell us why — this shapes what we build next.</p>
          <div className="space-y-2">
            {['Too expensive right now', 'I finished my book', 'Missing a feature I need', 'Switching to another tool', 'Something else'].map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => setCancelReason(reason)}
                className={cn('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors', cancelReason === reason ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <span className={cn('h-4 w-4 rounded-full border', cancelReason === reason && 'border-[5px] border-primary')} />
                {reason}
              </button>
            ))}
          </div>
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            On the free plan you keep up to {plans?.find((entry) => entry.id === 'plan_free')?.features.maxBooks ?? 1} book projects, {plans?.find((entry) => entry.id === 'plan_free')?.features.storageGb ?? 1} GB storage and PDF export only.
          </p>
        </div>
      </Modal>

      <p className="text-center text-xs text-muted-foreground">
        Last plan change {subscription ? timeAgo(subscription.startedAt) : 'never'} · billing runs through the mock payment provider.
      </p>
    </div>
  );
}
