import * as React from 'react';
import { HardDrive, RefreshCcw, Server, Trash2, UploadCloud } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { useConfirm, Modal } from '@/components/ui/overlays';
import { BarsChart, DonutChart } from '@/components/ui/charts';
import { DataTable, EmptyState, ProgressList, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminStorage, keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatBytes } from '@/lib/utils';
import { formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterSelect, Toolbar } from './shared';
import type { StorageObject } from '@/types/domain';

export default function AdminStoragePage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data, isLoading, refetch } = useAdminStorage();
  const [kind, setKind] = React.useState('all');
  const [detail, setDetail] = React.useState<StorageObject | null>(null);

  const objects = React.useMemo(() => ((data?.objects ?? []) as StorageObject[]).filter((object) => kind === 'all' || object.kind === kind), [data, kind]);

  const remove = useAdminAction(
    (objectId: string) => adminService.removeStorageObject(objectId, actor),
    { success: 'Object deleted', detail: 'Freed space is reflected in every usage meter.', invalidate: [keys.storage, keys.adminOverview] },
  );

  const totals = data?.totals;

  const columns: Column<StorageObject>[] = [
    {
      key: 'label',
      header: 'Object',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.label}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">{row.key}</p>
        </div>
      ),
    },
    { key: 'kind', header: 'Kind', render: (row) => <Badge variant="outline" className="text-2xs">{row.kind}</Badge> },
    { key: 'bucket', header: 'Bucket', render: (row) => <span className="text-2xs">{row.bucket}</span> },
    { key: 'mimeType', header: 'Type', render: (row) => <span className="text-2xs text-muted-foreground">{row.mimeType}</span> },
    { key: 'sizeBytes', header: 'Size', align: 'right', sortable: true, render: (row) => formatBytes(row.sizeBytes) },
    { key: 'createdAt', header: 'Stored', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setDetail(row)}>Inspect</Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={async () => {
              const ok = await confirm({ title: `Delete ${row.label}?`, description: 'Anything referencing this object will show a broken asset. Orphan cleanup is usually safe.', destructive: true, confirmLabel: 'Delete object' });
              if (ok) { remove.mutate(row.id); setTimeout(() => void refetch(), 400); }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Storage" description="Object storage usage, quotas and cleanup. The provider is a mock R2 today and swaps for Cloudflare R2 in Phase 3.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { void adminService.reconcileStorage(actor).then((count) => { success('Storage reconciled', `Usage recomputed for ${count} accounts.`); void refetch(); }); }}><RefreshCcw className="h-3.5 w-3.5" /> Reconcile usage</Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Stored bytes" value={formatBytes(totals?.used ?? 0)} change={`of ${formatBytes(totals?.quota ?? 0)} quota`} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Objects" value={formatNumber(totals?.objects ?? 0)} icon={<UploadCloud className="h-4 w-4" />} />
        <StatCard label="Largest object" value={formatBytes(totals?.largest ?? 0)} />
        <StatCard label="Buckets" value={String(new Set((data?.objects ?? []).map((object) => object.bucket)).size)} icon={<Server className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Usage by account</CardTitle></CardHeader>
          <CardContent>
            <BarsChart data={(data?.usage ?? []).slice(0, 8).map((entry) => ({ label: entry.userName.split(' ')[0], bytes: Math.round(entry.usedBytes / 1048576) }))} dataKey="bytes" currency={false} height={220} />
            <p className="mt-1 text-2xs text-muted-foreground">Values are megabytes per account.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Object mix</CardTitle></CardHeader>
          <CardContent><DonutChart height={220} data={Array.from(new Set((data?.objects ?? []).map((object) => object.kind))).map((entry) => ({ name: entry, value: (data?.objects ?? []).filter((object) => object.kind === entry).reduce((total, object) => total + object.sizeBytes, 0) }))} /></CardContent>
        </Card>
      </div>

      <Toolbar className="mt-4">
        <FilterSelect label="Kind" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All kinds' }, ...[...new Set((data?.objects ?? []).map((object) => object.kind))].map((entry) => ({ value: entry, label: entry }))]} />
        <span className="text-2xs text-muted-foreground">{objects.length} objects shown</span>
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={objects}
            loading={isLoading}
            emptyState={<EmptyState icon={<HardDrive className="h-5 w-5" />} title="No objects" description="Assets appear here after uploads, exports and AI generations." />}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quota health</CardTitle>
            <CardDescription className="text-xs">Accounts close to their plan limit are flagged for upgrade prompts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.usage ?? []).slice(0, 6).map((entry) => (
              <ProgressList
                key={entry.userId}
                items={[{
                  label: `${entry.userName} · ${entry.planName}`,
                  value: Math.min(100, Math.round((entry.usedBytes / Math.max(1, entry.quotaBytes)) * 100)),
                  hint: `${formatBytes(entry.usedBytes)} of ${formatBytes(entry.quotaBytes)} · ${entry.bookFiles} book files · ${entry.imageAssets} images · ${entry.exportFiles} exports`,
                }]}
              />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Retention policy</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Export files</span><span>30 days</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Generated images</span><span>Keep while the book exists</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Trashed books</span><span>30 days before purge</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Audit logs</span><span>12 months</span></p>
            <Separator />
            <p className="text-2xs text-muted-foreground">Retention runs as a scheduled job in Phase 3; the manual cleanup actions above cover the demo.</p>
          </CardContent>
        </Card>
      </div>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => !next && setDetail(null)}
        title={detail?.label ?? 'Object'}
        description={detail ? `${detail.kind} · ${detail.bucket}` : undefined}
        footer={<Button variant="outline" onClick={() => setDetail(null)}>Close</Button>}
      >
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Key</span><span className="truncate font-mono text-2xs">{detail.key}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Size</span><span>{formatBytes(detail.sizeBytes)}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">MIME</span><span>{detail.mimeType}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Owner</span><span>{detail.ownerId}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Stored</span><span>{timeAgo(detail.createdAt)}</span></p>
            </div>
            {detail.mimeType.startsWith('image/') && <img src={detail.url} alt={detail.label} className="max-h-56 w-full rounded border object-contain" />}
            <p className="break-all rounded bg-muted/50 p-2 font-mono text-2xs">{detail.url}</p>
          </div>
        )}
      </Modal>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Provider</CardTitle>
          <CardDescription className="text-xs">Storage abstraction status.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs sm:grid-cols-3">
          <p className="rounded border p-2"><span className="block text-2xs text-muted-foreground">Active provider</span>MockR2Provider (in-browser, localStorage-backed)</p>
          <p className="rounded border p-2"><span className="block text-2xs text-muted-foreground">Swap target</span>Cloudflare R2 via signed uploads — no UI changes required</p>
          <p className="rounded border p-2"><span className="block text-2xs text-muted-foreground">Interfaces used</span>uploadFile · putDataUrl · generatedPlaceholder · download · objects · delete</p>
        </CardContent>
      </Card>
    </div>
  );
}
