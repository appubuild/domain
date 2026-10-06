import * as React from 'react';
import { Megaphone, MousePointerClick, Plus, Ticket, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch } from '@/components/ui/primitives';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { BarsChart } from '@/components/ui/charts';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { usePromos, keys } from '@/hooks/queries';
import { cmsService } from '@/services';
import { formatDate, formatNumber } from '@/lib/format';
import { slugify } from '@/lib/utils';
import { useAdminAction, FilterSelect, StatusPill, Toolbar } from './shared';
import type { Promo } from '@/types/domain';

const PLACEMENTS: Promo['placement'][] = ['top-bar', 'homepage-hero', 'homepage-mid', 'marketplace', 'dashboard'];
const TYPES: Promo['type'][] = ['banner', 'coupon', 'campaign', 'announcement'];

export default function AdminPromotionsPage() {
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: promos, isLoading, refetch } = usePromos();
  const [placement, setPlacement] = React.useState('all');
  const [editing, setEditing] = React.useState<Partial<Promo> | null>(null);

  const save = useAdminAction(
    (promo: Partial<Promo>) => {
      if (promo.id) return cmsService.updatePromo(promo.id, promo);
      return cmsService.createPromo(promo);
    },
    { success: 'Promotion saved', detail: 'Live placements update immediately.', invalidate: [keys.promos()] },
  );

  const rows = ((promos ?? []) as Promo[]).filter((promo) => placement === 'all' || promo.placement === placement);
  const impressions = rows.reduce((total, promo) => total + promo.impressions, 0);
  const clicks = rows.reduce((total, promo) => total + promo.clicks, 0);

  return (
    <div>
      <PageHeader title="Promotions" description="Banners, coupons, campaigns and announcements — with placement and click tracking.">
        <Button
          size="sm"
          onClick={() => setEditing({
            name: '',
            type: 'banner',
            message: '',
            placement: 'top-bar',
            ctaLabel: 'Learn more',
            ctaHref: '/pricing',
            discountPercent: 0,
            code: '',
            startsAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 30 * 86400000).toISOString(),
            active: true,
          })}
        >
          <Plus className="h-3.5 w-3.5" /> New promotion
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Promotions" value={formatNumber(rows.length)} icon={<Megaphone className="h-4 w-4" />} />
        <StatCard label="Active" value={formatNumber(rows.filter((promo) => promo.active).length)} />
        <StatCard label="Impressions" value={formatNumber(impressions)} icon={<Ticket className="h-4 w-4" />} />
        <StatCard label="Clicks" value={formatNumber(clicks)} change={`${impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : 0}% CTR`} icon={<MousePointerClick className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Clicks by promotion</CardTitle></CardHeader>
          <CardContent><BarsChart data={rows.map((promo) => ({ label: promo.name.slice(0, 14), clicks: promo.clicks }))} dataKey="clicks" currency={false} height={200} /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Placement coverage</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {PLACEMENTS.map((entry) => {
              const promo = cmsService.promoFor(entry);
              return (
                <p key={entry} className="flex items-center justify-between border-b py-1 text-xs last:border-0">
                  <span className="capitalize text-muted-foreground">{entry.replace('-', ' ')}</span>
                  <span>{promo ? <Badge variant="success" className="text-2xs">{promo.name}</Badge> : <span className="text-2xs text-muted-foreground">empty</span>}</span>
                </p>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Toolbar className="mt-4">
        <FilterSelect label="Placement" value={placement} onChange={setPlacement} options={[{ value: 'all', label: 'All placements' }, ...PLACEMENTS.map((entry) => ({ value: entry, label: entry.replace('-', ' ') }))]} />
        <Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
      </Toolbar>

      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading && Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        {rows.map((promo) => (
          <Card key={promo.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate text-sm">{promo.name}</CardTitle>
                  <CardDescription className="truncate text-2xs capitalize">{promo.type} · {promo.placement.replace('-', ' ')} · {formatDate(promo.startsAt)} → {formatDate(promo.endsAt)}</CardDescription>
                </div>
                <StatusPill value={promo.active ? 'active' : 'paused'} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="rounded bg-muted/50 p-2 text-xs">{promo.message}</p>
              <div className="flex flex-wrap gap-1.5 text-2xs">
                {promo.discountPercent > 0 && <Badge variant="accent" className="text-2xs">{promo.discountPercent}% off</Badge>}
                {promo.code && <Badge variant="outline" className="text-2xs">code: {promo.code}</Badge>}
                <Badge variant="outline" className="text-2xs">{formatNumber(promo.impressions)} views</Badge>
                <Badge variant="outline" className="text-2xs">{formatNumber(promo.clicks)} clicks</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="outline" onClick={() => setEditing(promo)}>Edit</Button>
                <Button size="xs" variant="outline" onClick={() => { cmsService.updatePromo(promo.id, { active: !promo.active }); success(promo.active ? 'Promotion paused' : 'Promotion live'); void refetch(); }}>{promo.active ? 'Pause' : 'Activate'}</Button>
                <Button size="xs" variant="ghost" onClick={() => { cmsService.trackPromoClick(promo.id); info('Click recorded', 'Promo analytics incremented.'); void refetch(); }}>Simulate click</Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete “${promo.name}”?`, description: 'The placement clears immediately.', destructive: true, confirmLabel: 'Delete promotion' });
                    if (ok) { cmsService.removePromo(promo.id); success('Promotion deleted'); void refetch(); }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && <EmptyState icon={<Megaphone className="h-5 w-5" />} title="No promotions" description="Create a banner or coupon to start a campaign." />}

      <Modal
        open={Boolean(editing)}
        onOpenChange={(next) => !next && setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : 'New promotion'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editing?.name || editing.name.length < 3) return;
                save.mutate(editing);
                setEditing(null);
              }}
            >
              Save promotion
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="pr-name" className="text-xs">Name</Label><Input id="pr-name" value={editing.name ?? ''} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-type" className="text-xs">Type</Label>
                <select id="pr-type" value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value as Promo['type'] })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-placement" className="text-xs">Placement</Label>
                <select id="pr-placement" value={editing.placement} onChange={(event) => setEditing({ ...editing, placement: event.target.value as Promo['placement'] })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {PLACEMENTS.map((entry) => <option key={entry} value={entry}>{entry.replace('-', ' ')}</option>)}
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="pr-discount" className="text-xs">Discount %</Label><Input id="pr-discount" type="number" value={editing.discountPercent ?? 0} onChange={(event) => setEditing({ ...editing, discountPercent: Number(event.target.value) })} /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-code" className="text-xs">Coupon code</Label><Input id="pr-code" value={editing.code ?? ''} onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase() })} placeholder="SPRING20" /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-cta" className="text-xs">CTA label</Label><Input id="pr-cta" value={editing.ctaLabel ?? ''} onChange={(event) => setEditing({ ...editing, ctaLabel: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-href" className="text-xs">CTA link</Label><Input id="pr-href" value={editing.ctaHref ?? ''} onChange={(event) => setEditing({ ...editing, ctaHref: event.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-start" className="text-xs">Starts</Label><Input id="pr-start" type="date" value={editing.startsAt?.slice(0, 10) ?? ''} onChange={(event) => setEditing({ ...editing, startsAt: new Date(event.target.value).toISOString() })} /></div>
              <div className="space-y-1.5"><Label htmlFor="pr-end" className="text-xs">Ends</Label><Input id="pr-end" type="date" value={editing.endsAt?.slice(0, 10) ?? ''} onChange={(event) => setEditing({ ...editing, endsAt: new Date(event.target.value).toISOString() })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="pr-message" className="text-xs">Message</Label><textarea id="pr-message" rows={3} value={editing.message ?? ''} onChange={(event) => setEditing({ ...editing, message: event.target.value })} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            <Separator />
            <label className="flex items-center justify-between rounded border p-2 text-xs">Active <Switch checked={Boolean(editing.active)} onCheckedChange={(checked) => setEditing({ ...editing, active: checked })} /></label>
            <p className="text-2xs text-muted-foreground">Only one promotion renders per placement; the newest active match wins. Codes apply at checkout in the marketplace.</p>
            {!editing.code && editing.name && (
              <Button size="xs" variant="ghost" onClick={() => setEditing({ ...editing, code: slugify(editing.name ?? 'promo').toUpperCase().slice(0, 12) })}>Generate code from name</Button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
