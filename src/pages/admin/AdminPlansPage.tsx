import * as React from 'react';
import { Check, Crown, Layers, Plus, Save, X } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminOverview, usePlans, keys } from '@/hooks/queries';
import { adminService, subscriptionService } from '@/services';
import { EXPORT_FORMAT_INFO } from '@/data/constants';
import { formatCurrency, formatNumber } from '@/lib/format';
import { useAdminAction, useAdminActor, StatusPill } from './shared';
import type { ExportFormat, Plan, PlanFeatureSet } from '@/types/domain';

const FORMATS: ExportFormat[] = ['pdf', 'print-pdf', 'epub', 'epub3', 'docx', 'html', 'txt'];
const BOOLEAN_FLAGS: { key: keyof PlanFeatureSet; label: string }[] = [
  { key: 'premiumTemplates', label: 'Premium templates' },
  { key: 'aiImageGeneration', label: 'AI image generation' },
  { key: 'coverGeneration', label: 'AI cover generation' },
  { key: 'marketplaceSelling', label: 'Marketplace selling' },
  { key: 'collaboration', label: 'Collaboration & comments' },
  { key: 'advancedEditor', label: 'Advanced editor tools' },
  { key: 'printProfiles', label: 'Print profiles' },
  { key: 'customDomain', label: 'Custom domain' },
  { key: 'watermarkFree', label: 'Watermark-free exports' },
];

export default function AdminPlansPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data: plans, refetch } = usePlans();
  const { data: overview } = useAdminOverview();
  const [editing, setEditing] = React.useState<Plan | null>(null);
  const [tab, setTab] = React.useState<'pricing' | 'entitlements'>('pricing');
  const [createOpen, setCreateOpen] = React.useState(false);

  const save = useAdminAction(
    (plan: Plan) => adminService.updatePlan(plan, actor),
    { success: 'Plan saved', detail: 'Entitlements update app-wide immediately.', invalidate: [keys.plans, keys.adminOverview] },
  );

  const rows = plans ?? [];

  return (
    <div>
      <PageHeader title="Plans & entitlements" description="Pricing and limits here are the single source of truth for every upgrade prompt in the app.">
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New plan</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Plans" value={formatNumber(rows.length)} change={`${rows.filter((plan) => plan.active).length} active`} icon={<Layers className="h-4 w-4" />} />
        <StatCard label="MRR" value={formatCurrency(overview?.subscriptions.mrr ?? 0)} change={`${formatCurrency(overview?.subscriptions.arr ?? 0)} ARR`} />
        <StatCard label="Active subscriptions" value={formatNumber(overview?.subscriptions.active ?? 0)} icon={<Crown className="h-4 w-4" />} />
        <StatCard label="Trial conversion" value={`${overview?.subscriptions.trialConversion ?? 0}%`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {rows.map((plan) => (
          <Card key={plan.id} className={plan.highlight ? 'border-primary' : undefined}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-1.5 text-sm">{plan.name} {plan.badge && <Badge variant="accent" className="text-2xs">{plan.badge}</Badge>}</CardTitle>
                  <CardDescription className="text-xs">{plan.tagline}</CardDescription>
                </div>
                <StatusPill value={plan.active ? 'active' : 'inactive'} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-2xl font-semibold">{formatCurrency(plan.priceMonthly)}<span className="text-xs font-normal text-muted-foreground">/month</span></p>
              <p className="text-2xs text-muted-foreground">{formatCurrency(plan.priceYearly)}/year · {(plan.commissionRate * 100).toFixed(0)}% marketplace commission</p>
              <ul className="space-y-1 text-2xs">
                <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-600" /> {plan.features.maxBooks === -1 ? 'Unlimited' : plan.features.maxBooks} books · {plan.features.storageGb} GB storage</li>
                <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-600" /> {formatNumber(plan.features.aiCredits)} AI credits · {formatNumber(plan.features.aiImageCredits)} images</li>
                <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-600" /> {plan.features.exportFormats.length} export formats</li>
                <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-600" /> {plan.features.teamSeats} seat(s) · {plan.features.support} support</li>
              </ul>
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={() => { setEditing(plan); setTab('pricing'); }}><Save className="h-3 w-3" /> Edit plan</Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    save.mutate({ ...plan, active: !plan.active });
                    success(plan.active ? `${plan.name} hidden from pricing` : `${plan.name} available again`);
                  }}
                >
                  {plan.active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete ${plan.name}?`, description: 'Accounts on this plan fall back to Free. This is only possible for plans nobody is on.', destructive: true, confirmLabel: 'Delete plan' });
                    if (ok) { success('Plan deletion blocked', 'Plan deletion is disabled in the demo build to protect existing subscriptions.'); }
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Feature comparison matrix</CardTitle>
          <CardDescription className="text-xs">This is exactly what the app enforces through <code className="rounded bg-muted px-1">entitlementsFor(userId)</code>.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b text-left text-2xs text-muted-foreground">
                <th className="py-2">Capability</th>
                {rows.map((plan) => <th key={plan.id} className="py-2 text-center">{plan.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Books', value: (plan: Plan) => (plan.features.maxBooks === -1 ? 'Unlimited' : String(plan.features.maxBooks)) },
                { label: 'Storage', value: (plan: Plan) => `${plan.features.storageGb} GB` },
                { label: 'AI credits / month', value: (plan: Plan) => formatNumber(plan.features.aiCredits) },
                { label: 'AI images', value: (plan: Plan) => formatNumber(plan.features.aiImageCredits) },
                { label: 'Seats', value: (plan: Plan) => String(plan.features.teamSeats) },
                { label: 'Support', value: (plan: Plan) => plan.features.support },
                ...BOOLEAN_FLAGS.map((flag) => ({ label: flag.label, value: (plan: Plan) => (plan.features[flag.key] ? '✓' : '—') })),
              ].map((row) => (
                <tr key={row.label} className="border-b last:border-0">
                  <td className="py-1.5 text-muted-foreground">{row.label}</td>
                  {rows.map((plan) => <td key={plan.id} className="py-1.5 text-center">{row.value(plan)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing ? `Edit ${editing.name}` : 'Edit plan'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => { if (editing) { save.mutate(editing); setEditing(null); } }}>Save plan</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as typeof tab)}
              size="sm"
              tabs={[{ value: 'pricing', label: 'Pricing & positioning' }, { value: 'entitlements', label: 'Entitlements' }]}
            />
            {tab === 'pricing' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="plan-name" className="text-xs">Name</Label><Input id="plan-name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="plan-badge" className="text-xs">Badge</Label><Input id="plan-badge" value={editing.badge ?? ''} onChange={(event) => setEditing({ ...editing, badge: event.target.value })} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="plan-tagline" className="text-xs">Tagline</Label><Input id="plan-tagline" value={editing.tagline} onChange={(event) => setEditing({ ...editing, tagline: event.target.value })} /></div>
                <div className="space-y-1.5"><Label htmlFor="plan-monthly" className="text-xs">Monthly price</Label><Input id="plan-monthly" type="number" value={editing.priceMonthly} onChange={(event) => setEditing({ ...editing, priceMonthly: Number(event.target.value) })} /></div>
                <div className="space-y-1.5"><Label htmlFor="plan-yearly" className="text-xs">Yearly price</Label><Input id="plan-yearly" type="number" value={editing.priceYearly} onChange={(event) => setEditing({ ...editing, priceYearly: Number(event.target.value) })} /></div>
                <div className="space-y-1.5"><Label htmlFor="plan-commission" className="text-xs">Marketplace commission (0–1)</Label><Input id="plan-commission" type="number" step={0.01} value={editing.commissionRate} onChange={(event) => setEditing({ ...editing, commissionRate: Number(event.target.value) })} /></div>
                <div className="space-y-1.5"><Label htmlFor="plan-order" className="text-xs">Display order</Label><Input id="plan-order" type="number" value={editing.order} onChange={(event) => setEditing({ ...editing, order: Number(event.target.value) })} /></div>
                <div className="flex items-center justify-between rounded border p-2 sm:col-span-2"><span className="text-xs">Highlight on the pricing page</span><Switch checked={editing.highlight} onCheckedChange={(checked) => setEditing({ ...editing, highlight: checked })} /></div>
                <div className="flex items-center justify-between rounded border p-2 sm:col-span-2"><span className="text-xs">Purchasable</span><Switch checked={editing.purchasable} onCheckedChange={(checked) => setEditing({ ...editing, purchasable: checked })} /></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="plan-marketing" className="text-xs">Marketing bullets (one per line)</Label>
                  <textarea
                    id="plan-marketing"
                    rows={4}
                    value={editing.marketingFeatures.join('\n')}
                    onChange={(event) => setEditing({ ...editing, marketingFeatures: event.target.value.split('\n').filter(Boolean) })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="f-books" className="text-xs">Max books (-1 = unlimited)</Label><Input id="f-books" type="number" value={editing.features.maxBooks} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, maxBooks: Number(event.target.value) } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="f-storage" className="text-xs">Storage (GB)</Label><Input id="f-storage" type="number" value={editing.features.storageGb} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, storageGb: Number(event.target.value) } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="f-credits" className="text-xs">AI credits / month</Label><Input id="f-credits" type="number" value={editing.features.aiCredits} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, aiCredits: Number(event.target.value) } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="f-images" className="text-xs">AI image credits / month</Label><Input id="f-images" type="number" value={editing.features.aiImageCredits} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, aiImageCredits: Number(event.target.value) } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="f-seats" className="text-xs">Team seats</Label><Input id="f-seats" type="number" value={editing.features.teamSeats} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, teamSeats: Number(event.target.value) } })} /></div>
                  <div className="space-y-1.5">
                    <Label htmlFor="f-support" className="text-xs">Support level</Label>
                    <select id="f-support" value={editing.features.support} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, support: event.target.value as PlanFeatureSet['support'] } })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                      {['community', 'email', 'priority', 'dedicated'].map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="mb-2 text-xs font-medium">Export formats</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FORMATS.map((format) => {
                      const included = editing.features.exportFormats.includes(format);
                      return (
                        <button
                          key={format}
                          type="button"
                          onClick={() => setEditing({
                            ...editing,
                            features: {
                              ...editing.features,
                              exportFormats: included ? editing.features.exportFormats.filter((entry) => entry !== format) : [...editing.features.exportFormats, format],
                            },
                          })}
                          className={`rounded-full border px-2.5 py-1 text-2xs ${included ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                        >
                          {EXPORT_FORMAT_INFO[format]?.label ?? format}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Separator />
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {BOOLEAN_FLAGS.map((flag) => (
                    <div key={flag.key} className="flex items-center justify-between rounded border p-2">
                      <span className="text-xs">{flag.label}</span>
                      <Switch
                        checked={Boolean(editing.features[flag.key])}
                        onCheckedChange={(checked) => setEditing({ ...editing, features: { ...editing.features, [flag.key]: checked } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New plan"
        description="New plans appear on the pricing page as soon as they are active."
        footer={<Button variant="outline" onClick={() => setCreateOpen(false)}>Close</Button>}
      >
        <p className="text-xs text-muted-foreground">Duplicate an existing plan to keep the entitlement matrix consistent. Choose the plan to clone:</p>
        <div className="mt-3 space-y-1.5">
          {rows.map((plan) => (
            <Button
              key={plan.id}
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                const clone: Plan = {
                  ...plan,
                  id: `${plan.id}_copy`,
                  name: `${plan.name} (copy)`,
                  slug: `${plan.slug}-copy`,
                  order: rows.length + 1,
                  highlight: false,
                  badge: 'New',
                };
                void adminService.createPlan(clone, actor).then(() => {
                  success('Plan created', `${clone.name} is ready to edit.`);
                  setCreateOpen(false);
                  void refetch();
                });
              }}
            >
              <Layers className="h-3.5 w-3.5" /> Clone {plan.name}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-2xs text-muted-foreground">Existing subscribers keep their plan; only new signups see a new plan until you migrate accounts.</p>
      </Modal>

      <p className="mt-3 text-2xs text-muted-foreground">
        Current public pricing: {subscriptionService.plans().map((plan) => `${plan.name} ${formatCurrency(plan.priceMonthly)}`).join(' · ')}
      </p>
    </div>
  );
}
