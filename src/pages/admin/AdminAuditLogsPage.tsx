import * as React from 'react';
import { Download, Eraser, Filter, History, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator } from '@/components/ui/primitives';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { BarsChart } from '@/components/ui/charts';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { FilterSelect, StatusPill, useAdminAction, useAdminActor } from './shared';
import { keys, useAdminUsers, useAuditLogs } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatDateTime, timeAgo } from '@/lib/format';
import type { AuditLog, User } from '@/types/domain';

const TARGET_TYPES = ['all', 'user', 'book', 'review', 'report', 'order', 'plan', 'template', 'category', 'settings', 'system', 'storage', 'ai', 'flag', 'email', 'promo'] as const;

function actionGroup(action: string) {
  return action.split('.')[0];
}

export default function AdminAuditLogsPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info } = useToast();
  const [query, setQuery] = React.useState('');
  const [action, setAction] = React.useState('all');
  const [adminId, setAdminId] = React.useState('all');
  const [targetType, setTargetType] = React.useState('all');
  const [range, setRange] = React.useState<'24h' | '7d' | '30d' | 'all'>('all');
  const [limit, setLimit] = React.useState(25);
  const [selected, setSelected] = React.useState<AuditLog | null>(null);
  const [compare, setCompare] = React.useState<AuditLog | null>(null);

  const logs = useAuditLogs({ query, action, adminId });
  const users = useAdminUsers({});

  const rows = React.useMemo(() => {
    let list = logs.data ?? [];
    if (targetType !== 'all') list = list.filter((log) => log.targetType === targetType);
    if (range !== 'all') {
      const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
      const cutoff = Date.now() - hours * 3600_000;
      list = list.filter((log) => new Date(log.createdAt).getTime() >= cutoff);
    }
    return list;
  }, [logs.data, targetType, range]);

  const admins = React.useMemo(() => {
    const seen = new Map<string, string>();
    (logs.data ?? []).forEach((log) => seen.set(log.adminId, log.adminName));
    return [{ value: 'all', label: 'All admins' }, ...[...seen].map(([value, label]) => ({ value, label }))];
  }, [logs.data]);

  const actionOptions = React.useMemo(() => {
    const groups = new Set((logs.data ?? []).map((log) => actionGroup(log.action)));
    return [{ value: 'all', label: 'All actions' }, ...[...groups].sort().map((group) => ({ value: group, label: group }))];
  }, [logs.data]);

  const stats = React.useMemo(() => {
    const all = logs.data ?? [];
    const today = all.filter((log) => new Date(log.createdAt).toDateString() === new Date().toDateString());
    const destructive = all.filter((log) => /delete|remove|clear|refund|ban|suspend|reject|hide/.test(log.action));
    const byAdmin = new Map<string, number>();
    all.forEach((log) => byAdmin.set(log.adminName, (byAdmin.get(log.adminName) ?? 0) + 1));
    const topAdmin = [...byAdmin].sort((a, b) => b[1] - a[1])[0];
    return { total: all.length, today: today.length, destructive: destructive.length, topAdmin };
  }, [logs.data]);

  const actionChart = React.useMemo(() => {
    const counts = new Map<string, number>();
    (logs.data ?? []).forEach((log) => counts.set(actionGroup(log.action), (counts.get(actionGroup(log.action)) ?? 0) + 1));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  }, [logs.data]);

  const clearLogs = useAdminAction(() => adminService.clearAuditLogs(actor), {
    success: 'Audit log cleared',
    detail: 'A single entry recording the clear remains.',
    invalidate: [keys.auditLogs({})],
  });

  const refresh = async () => {
    await logs.refetch();
    success('Audit log refreshed');
  };

  const exportCsv = () => {
    const header = 'when,admin,action,target,targetType,ip,before,after';
    const lines = rows.map((log) =>
      [log.createdAt, log.adminName, log.action, log.target, log.targetType, log.ip, log.before, log.after]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scriptora-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    success('Export started', `${rows.length} entries written to CSV.`);
  };

  const columns: Column<AuditLog>[] = [
    {
      key: 'when',
      header: 'When',
      sortable: true,
      render: (log) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{timeAgo(log.createdAt)}</p>
          <p className="truncate text-2xs text-muted-foreground">{formatDateTime(log.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'admin',
      header: 'Actor',
      render: (log) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{log.adminName}</p>
          <p className="truncate text-2xs text-muted-foreground">{log.ip}</p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (log) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="text-2xs">{actionGroup(log.action)}</Badge>
          <span className="text-xs">{log.action.split('.').slice(1).join('.') || '—'}</span>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (log) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{log.target || '—'}</p>
          <p className="truncate text-2xs text-muted-foreground">{log.targetType}</p>
        </div>
      ),
    },
    {
      key: 'change',
      header: 'Change',
      render: (log) => (
        <span className="line-clamp-2 max-w-[260px] text-2xs text-muted-foreground">
          {log.before ? log.before.slice(0, 60) : '(none)'} → {log.after ? log.after.slice(0, 60) : '(none)'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (log) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={(event) => { event.stopPropagation(); setSelected(log); }}>Inspect</Button>
          <Button size="xs" variant="ghost" onClick={(event) => { event.stopPropagation(); setCompare(log); }}>Who else?</Button>
        </div>
      ),
    },
  ];

  const actorHistory = React.useMemo(() => {
    if (!compare) return [];
    return (logs.data ?? []).filter((log) => log.adminId === compare.adminId).slice(0, 12);
  }, [compare, logs.data]);

  return (
    <div>
      <PageHeader title="Audit logs" description="Every privileged write is recorded: who did it, what changed, from which address.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              const ok = await confirm({
                title: 'Clear the audit log?',
                description: 'Every entry except the record of this action is deleted. Export first if you need a copy.',
                destructive: true,
                confirmLabel: 'Clear log',
              });
              if (ok) clearLogs.mutate();
            }}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear log
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total entries" value={stats.total} hint="across every admin area" icon={<History className="h-4 w-4" />} />
        <StatCard label="Today" value={stats.today} hint="since midnight" tone="info" />
        <StatCard label="Destructive actions" value={stats.destructive} hint="deletes, refunds, bans" tone={stats.destructive ? 'warning' : 'default'} />
        <StatCard label="Most active" value={stats.topAdmin ? stats.topAdmin[0] : '—'} hint={stats.topAdmin ? `${stats.topAdmin[1]} entries` : 'no activity yet'} icon={<ShieldCheck className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,340px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-1.5 text-sm"><Filter className="h-4 w-4" /> Trail</CardTitle>
            <CardDescription className="text-xs">Filter by keyword, action group, responsible admin, target type or time window.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, target, admin" className="pl-7" aria-label="Search audit log" />
              </div>
              <FilterSelect label="Action" value={action} onChange={setAction} options={actionOptions} />
              <FilterSelect label="Admin" value={adminId} onChange={setAdminId} options={admins} />
              <FilterSelect label="Target" value={targetType} onChange={setTargetType} options={TARGET_TYPES.map((type) => ({ value: type, label: type === 'all' ? 'All targets' : type }))} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['24h', '7d', '30d', 'all'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`rounded border px-2 py-0.5 text-2xs ${range === option ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40'}`}
                >
                  {option === 'all' ? 'All time' : `Last ${option}`}
                </button>
              ))}
              <span className="ml-auto text-2xs text-muted-foreground">{rows.length} matching entr{rows.length === 1 ? 'y' : 'ies'}</span>
            </div>

            <DataTable
              columns={columns}
              rows={rows.slice(0, limit)}
              rowKey={(log) => log.id}
              loading={logs.isLoading}
              onRowClick={setSelected}
              emptyState={<EmptyState icon={<History className="h-5 w-5" />} title="No entries match" description="Widen the filters or clear the search to see older activity." actions={<Button size="sm" variant="outline" onClick={() => { setQuery(''); setAction('all'); setAdminId('all'); setTargetType('all'); setRange('all'); }}>Reset filters</Button>} />}
            />
            {rows.length > limit && (
              <div className="flex items-center justify-between">
                <p className="text-2xs text-muted-foreground">Showing {limit} of {rows.length}</p>
                <div className="flex gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => setLimit((current) => current + 25)}>Load 25 more</Button>
                  <Button size="xs" variant="ghost" onClick={() => setLimit(rows.length)}>Show all</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Activity by area</CardTitle>
              <CardDescription className="text-xs">Which part of the console your team touches most.</CardDescription>
            </CardHeader>
            <CardContent>
              {actionChart.length ? <BarsChart data={actionChart} dataKey="value" height={220} /> : <p className="py-8 text-center text-xs text-muted-foreground">Nothing to chart yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Admins</CardTitle>
              <CardDescription className="text-xs">Staff accounts that can write to the platform.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {((users.data ?? []) as User[]).filter((user) => user.role !== 'user').slice(0, 6).map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => { setAdminId(user.id); info(`Filtered by ${user.name}`, 'Only this admin’s actions are shown.'); }}
                  className="flex w-full items-center justify-between rounded border p-2 text-left text-xs hover:border-primary/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{user.name}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{user.email}</span>
                  </span>
                  <StatusPill value={user.role === 'admin' ? 'active' : 'beta'} />
                </button>
              ))}
              {!((users.data ?? []) as User[]).some((user) => user.role !== 'user') && <p className="text-xs text-muted-foreground">No staff accounts.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} title="Audit entry" description={selected ? `${selected.action} · ${formatDateTime(selected.createdAt)}` : undefined} size="lg">
        {selected && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Detail label="Actor" value={selected.adminName} />
              <Detail label="IP address" value={selected.ip} />
              <Detail label="Target" value={selected.target || '—'} />
              <Detail label="Target type" value={selected.targetType} />
            </div>
            <Separator />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded border p-2">
                <p className="mb-1 text-2xs font-medium text-muted-foreground">Before</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-2xs">{selected.before || '(none)'}</pre>
              </div>
              <div className="rounded border border-primary/30 bg-primary/5 p-2">
                <p className="mb-1 text-2xs font-medium text-muted-foreground">After</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-2xs">{selected.after || '(none)'}</pre>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(compare)} onOpenChange={(open) => !open && setCompare(null)} title={compare ? `Everything ${compare.adminName} did` : 'Admin history'} description="The last dozen writes by this account — useful when reviewing an incident.">
        <div className="space-y-1.5">
          {actorHistory.map((log) => (
            <button key={log.id} type="button" onClick={() => { setCompare(null); setSelected(log); }} className="w-full rounded border p-2 text-left hover:border-primary/40">
              <p className="flex items-center justify-between text-xs font-medium">{log.action} <span className="text-2xs text-muted-foreground">{timeAgo(log.createdAt)}</span></p>
              <p className="truncate text-2xs text-muted-foreground">{log.targetType} · {log.target}</p>
            </button>
          ))}
          {!actorHistory.length && <p className="text-xs text-muted-foreground">No other entries.</p>}
        </div>
      </Modal>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <p className="flex items-center gap-1 text-2xs text-muted-foreground"><Label className="text-2xs">{label}</Label></p>
      <p className="break-words text-xs">{value}</p>
    </div>
  );
}
