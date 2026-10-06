import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, Download, Mail, RefreshCcw, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardContent, Input } from '@/components/ui/primitives';
import { DropdownMenu, Modal, useConfirm, type MenuItemDef } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminOverview, useAdminUsers, usePlans, keys } from '@/hooks/queries';
import { adminService, emailService } from '@/services';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterInput, FilterSelect, StatusPill, Toolbar, ROLE_FILTERS } from './shared';
import type { User } from '@/types/domain';

type Row = User & { bookCount: number; revenue: number };

export default function AdminUsersPage() {
  const navigate = useNavigate();
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data: overview } = useAdminOverview();
  const { data: plans } = usePlans();
  const [query, setQuery] = React.useState('');
  const [role, setRole] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [planId, setPlanId] = React.useState('all');
  const [sort, setSort] = React.useState<'recent' | 'name' | 'books' | 'revenue'>('recent');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [emailBody, setEmailBody] = React.useState({ subject: 'A note from Scriptora', body: 'Hi — a quick note from the Scriptora team.' });

  const { data: users, isLoading, isError, refetch } = useAdminUsers({ query: query || undefined, role, status, planId: planId === 'all' ? undefined : planId, sort });

  const updateUser = useAdminAction(
    ({ userId, patch, note }: { userId: string; patch: Partial<User>; note?: string }) => adminService.updateUser(userId, patch, actor, note),
    { success: 'User updated', detail: 'The change is recorded in the audit log.', invalidate: [keys.adminUsers(), keys.adminOverview] },
  );

  const rows = (users ?? []) as Row[];

  const setMany = async (patch: Partial<User>, label: string) => {
    for (const userId of selected) await adminService.updateUser(userId, patch, actor, `bulk ${label}`);
    success(`${selected.length} users ${label}`, 'Recorded in the audit log.');
    setSelected([]);
    void refetch();
  };

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'User',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          <Avatar name={row.name} src={row.avatarUrl} size={28} />
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{row.name}</p>
            <p className="truncate text-2xs text-muted-foreground">{row.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => <StatusPill value={row.role} /> },
    { key: 'plan', header: 'Plan', render: (row) => <span className="text-2xs">{plans?.find((plan) => plan.id === row.planId)?.name ?? row.planId}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'books', header: 'Books', align: 'right', sortable: true, render: (row) => formatNumber(row.bookCount) },
    { key: 'revenue', header: 'Revenue', align: 'right', sortable: true, render: (row) => formatCurrency(row.revenue) },
    { key: 'lastActiveAt', header: 'Last active', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.lastActiveAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <DropdownMenu
          align="end"
          trigger={<Button size="xs" variant="ghost">Manage</Button>}
          items={[
            { id: 'open', label: 'Open profile', onSelect: () => navigate(`/admin/users/${row.id}`) },
            { id: 'verify', label: row.emailVerified ? 'Mark email unverified' : 'Verify email', onSelect: () => updateUser.mutate({ userId: row.id, patch: { emailVerified: !row.emailVerified } }) },
            { id: 'role-author', label: 'Mark as author', onSelect: () => updateUser.mutate({ userId: row.id, patch: { isAuthor: true } }) },
            { id: 'role-mod', label: 'Make moderator', onSelect: () => updateUser.mutate({ userId: row.id, patch: { role: 'moderator' } }) },
            { id: 'role-admin', label: 'Make admin', onSelect: () => updateUser.mutate({ userId: row.id, patch: { role: 'admin' } }) },
            { id: 'reset', label: 'Reset usage counters', onSelect: () => { void adminService.resetUsage(row.id, actor).then(() => { success('Usage reset', `${row.name}'s AI and storage counters were cleared.`); void refetch(); }); } },
            { id: 'divider', label: '', divider: true },
            { id: 'suspend', label: row.status === 'suspended' ? 'Reactivate account' : 'Suspend account', destructive: row.status !== 'suspended', onSelect: async () => { const ok = await confirm({ title: row.status === 'suspended' ? `Reactivate ${row.name}?` : `Suspend ${row.name}?`, description: row.status === 'suspended' ? 'They will regain full access immediately.' : 'They lose the ability to sign in, publish and sell until reactivated.', destructive: row.status !== 'suspended', confirmLabel: row.status === 'suspended' ? 'Reactivate' : 'Suspend' }); if (ok) updateUser.mutate({ userId: row.id, patch: { status: row.status === 'suspended' ? 'active' : 'suspended' }, note: 'via users table' }); } },
          ] as MenuItemDef[]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Users" description="Search, filter and moderate every account. Actions write through the admin service into the audit log.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setEmailOpen(true)} disabled={selected.length === 0}><Mail className="h-3.5 w-3.5" /> Email selected ({selected.length})</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const rowsToExport = (users ?? []) as Row[];
              const csv = ['name,email,role,status,plan,books,revenue', ...rowsToExport.map((row) => [row.name, row.email, row.role, row.status, row.planId, row.bookCount, row.revenue].join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'scriptora-users.csv';
              link.click();
              URL.revokeObjectURL(url);
              success('CSV exported', `${rowsToExport.length} rows`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={formatNumber(overview?.users.total ?? 0)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Active" value={formatNumber(overview?.users.active ?? 0)} change={`${overview?.users.new7d ?? 0} new / 7d`} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Suspended" value={formatNumber(overview?.users.suspended ?? 0)} icon={<Ban className="h-4 w-4" />} />
        <StatCard label="Growth" value={`${overview?.users.growthPct ?? 0}%`} change="vs previous week" icon={<ShieldCheck className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search users" value={query} onChange={setQuery} placeholder="Search name, email or username" />
        <FilterSelect label="Role" value={role} onChange={setRole} options={ROLE_FILTERS} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, { value: 'pending', label: 'Pending' }]} />
        <FilterSelect label="Plan" value={planId} onChange={setPlanId} options={[{ value: 'all', label: 'All plans' }, ...(plans ?? []).map((plan) => ({ value: plan.id, label: plan.name }))]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'recent', label: 'Newest' }, { value: 'name', label: 'Name' }, { value: 'books', label: 'Most books' }, { value: 'revenue', label: 'Highest revenue' }]} />
        <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setRole('all'); setStatus('all'); setPlanId('all'); setSort('recent'); }}><RefreshCcw className="h-3.5 w-3.5" /> Reset</Button>
      </Toolbar>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <span className="text-xs font-medium">{selected.length} selected</span>
          <Button size="xs" variant="outline" onClick={() => void setMany({ status: 'active' }, 'reactivated')}><CheckCircle2 className="h-3 w-3" /> Reactivate</Button>
          <Button size="xs" variant="outline" onClick={() => void setMany({ status: 'suspended' }, 'suspended')}><Ban className="h-3 w-3" /> Suspend</Button>
          <Button size="xs" variant="outline" onClick={() => void setMany({ isAuthor: true }, 'marked as authors')}><UserCog className="h-3 w-3" /> Promote to author</Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          {isError ? (
            <EmptyState icon={<Ban className="h-5 w-5" />} title="Users could not be loaded" actions={<Button onClick={() => void refetch()}>Retry</Button>} />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              loading={isLoading}
              selectable
              selectedKeys={selected}
              onSelectionChange={setSelected}
              emptyState={<EmptyState icon={<Users className="h-5 w-5" />} title="No users match these filters" description="Try clearing the search or widening the filters." actions={<Button variant="outline" onClick={() => { setQuery(''); setRole('all'); setStatus('all'); setPlanId('all'); }}>Clear filters</Button>} />}
            />
          )}
        </CardContent>
      </Card>

      <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Trash2 className="h-3 w-3" /> Deleting an account removes their books, assets and marketplace listings — the mock database keeps the audit trail.
      </p>

      <Modal
        open={emailOpen}
        onOpenChange={setEmailOpen}
        title={`Email ${selected.length} user(s)`}
        description="Messages are queued through the mock email provider and recorded in the email event log."
        footer={
          <>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                void Promise.all(
                  selected.map((userId) => {
                    const user = rows.find((row) => row.id === userId);
                    return user ? emailService.send({ to: user.email, toName: user.name, template: 'system', meta: emailBody.subject }) : Promise.resolve(undefined);
                  }),
                );
                success(`${selected.length} emails queued`, 'Inspect delivery in Admin → Email.');
                setEmailOpen(false);
                setSelected([]);
              }}
            >
              <Mail className="h-3.5 w-3.5" /> Queue emails
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input value={emailBody.subject} onChange={(event) => setEmailBody((current) => ({ ...current, subject: event.target.value }))} aria-label="Subject" />
          <textarea value={emailBody.body} onChange={(event) => setEmailBody((current) => ({ ...current, body: event.target.value }))} rows={5} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Body" />
          <div className="flex flex-wrap gap-1.5">
            {['A note from Scriptora', 'Your book is ready to publish', 'Marketplace payout scheduled', 'We noticed unusual activity'].map((subject) => (
              <button key={subject} type="button" onClick={() => setEmailBody((current) => ({ ...current, subject }))} className="rounded border px-2 py-0.5 text-2xs hover:border-primary/50">{subject}</button>
            ))}
          </div>
        </div>
      </Modal>

      <p className="mt-3 text-2xs text-muted-foreground">
        Looking for a specific account? <Link to="/admin/authors" className="underline">Author management</Link> lists publishing profiles and verification.
      </p>
      <Badge variant="outline" className="mt-2">{rows.length} rows</Badge>
    </div>
  );
}
