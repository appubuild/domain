import type { ID, Invoice, Plan, Subscription, User } from '@/types/domain';
import { delay, uid } from '@/lib/utils';
import { getDatabase } from '@/store/db';
import { adminRepo, userRepo } from '@/repositories';
import { entitlementsFor } from './entitlements';
import { emailService } from './notificationService';

export const subscriptionService = {
  plans(includeInactive = false): Plan[] {
    const plans = userRepo.plans();
    return includeInactive ? plans : plans.filter((plan) => plan.active);
  },
  plan(id: ID): Plan | undefined {
    return userRepo.plan(id);
  },
  current(userId: ID): { subscription?: Subscription; plan: Plan; entitlements: ReturnType<typeof entitlementsFor> } {
    const user = userRepo.find(userId);
    const subscription = userRepo.subscriptionFor(userId);
    return {
      subscription,
      plan: userRepo.plan(subscription?.planId ?? user?.planId) ?? userRepo.plans()[0],
      entitlements: entitlementsFor(userId),
    };
  },
  usage(userId: ID) {
    const entitlement = entitlementsFor(userId);
    return entitlement.usage;
  },
  invoices(userId: ID): Invoice[] {
    return userRepo.invoices(userId);
  },
  allInvoices(): Invoice[] {
    return userRepo.invoices();
  },
  async changePlan(userId: ID, planId: ID, interval: 'monthly' | 'yearly' = 'monthly'): Promise<{ plan: Plan; subscription: Subscription; invoice?: Invoice }> {
    await delay(800);
    const plan = userRepo.plan(planId);
    if (!plan) throw new Error('That plan is not available.');
    const user = userRepo.find(userId) as User;
    const existing = userRepo.subscriptionFor(userId);
    const renewsAt = new Date(Date.now() + (interval === 'yearly' ? 365 : 30) * 86400000).toISOString();

    const subscription: Subscription = {
      id: existing?.id ?? uid('sub'),
      userId,
      planId,
      status: 'active',
      interval,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      renewsAt,
      seats: plan.features.teamSeats,
    };
    userRepo.upsertSubscription(subscription);
    userRepo.update(userId, { planId });

    let invoice: Invoice | undefined;
    const amount = interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
    if (amount > 0) {
      invoice = {
        id: uid('inv'),
        userId,
        subscriptionId: subscription.id,
        number: `SC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`,
        planName: `${plan.name} (${interval})`,
        amount,
        currency: plan.currency,
        status: 'paid',
        interval,
        createdAt: new Date().toISOString(),
        periodStart: new Date().toISOString(),
        periodEnd: renewsAt,
        method: 'Visa •••• 4242',
      };
      userRepo.addInvoice(invoice);
    }
    if (user) {
      await emailService.send({ to: user.email, toName: user.name, template: 'subscription', meta: `${plan.name} (${interval})` });
    }
    return { plan, subscription, invoice };
  },
  async cancel(userId: ID, reason = 'Not specified'): Promise<Subscription | undefined> {
    await delay(600);
    const subscription = userRepo.subscriptionFor(userId);
    if (!subscription) return undefined;
    const user = userRepo.find(userId);
    if (user) await emailService.send({ to: user.email, toName: user.name, template: 'subscription', meta: 'cancellation requested' });
    void reason;
    return userRepo.upsertSubscription({ ...subscription, status: 'canceled', canceledAt: new Date().toISOString() });
  },
  async resume(userId: ID): Promise<Subscription | undefined> {
    await delay(600);
    const subscription = userRepo.subscriptionFor(userId);
    if (!subscription) return undefined;
    return userRepo.upsertSubscription({ ...subscription, status: 'active', canceledAt: undefined });
  },
  async downgradeToFree(userId: ID): Promise<void> {
    await delay(700);
    const subscription = userRepo.subscriptionFor(userId);
    if (subscription) userRepo.upsertSubscription({ ...subscription, status: 'canceled', planId: 'plan_free', canceledAt: new Date().toISOString() });
    userRepo.update(userId, { planId: 'plan_free' });
  },
  // ------------------------------------------------------------ admin views
  /** Every subscription joined with its account and plan, for the admin table. */
  adminSubscriptions() {
    const db = getDatabase();
    return userRepo
      .subscriptions()
      .map((subscription) => {
        const user = db.users.find((entry) => entry.id === subscription.userId);
        const plan = userRepo.plan(subscription.planId);
        return {
          ...subscription,
          userName: user?.name ?? 'Unknown account',
          email: user?.email ?? '',
          planName: plan?.name ?? subscription.planId,
          mrr: plan ? (subscription.interval === 'yearly' ? Number((plan.priceYearly / 12).toFixed(2)) : plan.priceMonthly) : 0,
        };
      })
      .sort((a, b) => b.mrr - a.mrr);
  },
  /** Pushes the renewal date out — used by support for goodwill extensions. */
  extend(subscriptionId: ID, days: number) {
    const subscription = userRepo.subscriptions().find((entry) => entry.id === subscriptionId);
    if (!subscription) return undefined;
    const renewsAt = new Date(new Date(subscription.renewsAt).getTime() + days * 86400000).toISOString();
    return userRepo.upsertSubscription({ ...subscription, renewsAt, status: 'active', canceledAt: undefined });
  },
  /** Refunds the most recent paid invoice for an account, if one exists. */
  async refundLatest(userId: ID, actor: { id: ID; name: string }) {
    const invoice = userRepo.invoices(userId).find((entry) => entry.status === 'paid');
    if (!invoice) return undefined;
    return subscriptionService.refundInvoice(invoice.id, actor);
  },
  /** Marks an invoice refunded, records the audit entry and emails the customer. */
  async refundInvoice(invoiceId: ID, actor: { id: ID; name: string }) {
    await delay(500);
    const invoice = userRepo.invoices().find((entry) => entry.id === invoiceId);
    if (!invoice) return undefined;
    const updated = userRepo.updateInvoice(invoiceId, { status: 'refunded' });
    const user = userRepo.find(invoice.userId);
    adminRepo.addAuditLog({
      id: uid('audit'),
      adminId: actor.id,
      adminName: actor.name,
      action: 'subscription.refund',
      target: invoice.number,
      targetType: 'invoice',
      before: `status: ${invoice.status}`,
      after: 'status: refunded',
      ip: '10.0.0.1',
      createdAt: new Date().toISOString(),
    });
    if (user) await emailService.send({ to: user.email, toName: user.name, template: 'system', meta: `Refund for ${invoice.number}` });
    return updated;
  },

  comparison() {
    const plans = subscriptionService.plans();
    const featureKeys: { key: keyof Plan['features']; label: string; format?: (value: unknown) => string }[] = [
      { key: 'maxBooks', label: 'Book projects', format: (value) => (Number(value) < 0 ? 'Unlimited' : String(value)) },
      { key: 'storageGb', label: 'Asset storage', format: (value) => `${value} GB` },
      { key: 'aiCredits', label: 'AI writing credits', format: (value) => `${Number(value).toLocaleString()} / mo` },
      { key: 'aiImageCredits', label: 'AI image credits', format: (value) => `${Number(value).toLocaleString()} / mo` },
      { key: 'exportFormats', label: 'Export formats', format: (value) => `${(value as string[]).length} formats` },
      { key: 'premiumTemplates', label: 'Premium templates', format: (value) => (value ? 'Included' : '—') },
      { key: 'aiImageGeneration', label: 'AI image generation', format: (value) => (value ? 'Included' : '—') },
      { key: 'coverGeneration', label: 'AI cover generation', format: (value) => (value ? 'Included' : '—') },
      { key: 'marketplaceSelling', label: 'Marketplace selling', format: (value) => (value ? 'Included' : '—') },
      { key: 'collaboration', label: 'Collaboration', format: (value) => (value ? 'Editors & viewers' : '—') },
      { key: 'advancedEditor', label: 'Design mode & layers', format: (value) => (value ? 'Included' : '—') },
      { key: 'printProfiles', label: 'Print publishing profiles', format: (value) => (value ? 'Included' : '—') },
      { key: 'customDomain', label: 'Custom author domain', format: (value) => (value ? 'Included' : '—') },
      { key: 'teamSeats', label: 'Team seats', format: (value) => String(value) },
    ];
    return {
      plans,
      rows: featureKeys.map((row) => ({
        label: row.label,
        values: plans.map((plan) => (row.format ? row.format(plan.features[row.key]) : String(plan.features[row.key]))),
      })),
    };
  },
  adminStats() {
    const db = getDatabase();
    const byPlan = db.plans.map((plan) => ({
      plan,
      subscribers: db.users.filter((user) => user.planId === plan.id).length,
      mrr: db.users.filter((user) => user.planId === plan.id).length * plan.priceMonthly,
    }));
    const active = db.subscriptions.filter((subscription) => subscription.status === 'active').length;
    const pastDue = db.subscriptions.filter((subscription) => subscription.status === 'past_due').length;
    const canceled = db.subscriptions.filter((subscription) => subscription.status === 'canceled').length;
    return {
      byPlan,
      active,
      pastDue,
      canceled,
      mrr: byPlan.reduce((total, entry) => total + entry.mrr, 0),
      arr: byPlan.reduce((total, entry) => total + entry.mrr, 0) * 12,
      churnRate: 2.4,
      trialConversion: 38,
    };
  },
};
