import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Ban, BookOpen, CheckCircle2, Mail, RefreshCcw, ShieldOff, Trash2, UserCog } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch } from '@/components/ui/primitives';
import { Tabs, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminUser, usePlans, keys } from '@/hooks/queries';
import { adminService, emailService } from '@/services';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { formatBytes } from '@/lib/utils';
import { useAdminAction, useAdminActor, KeyValue, StatusPill } from './shared';
import type { User } from '@/types/domain';

export default function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, error } = useToast();
  const { data: detail, isLoading, refetch } = useAdminUser(userId);
  const { data: plans } = usePlans();
  const [tab, setTab] = React.useState('overview');
  const [note, setNote] = React.useState('');
  const [draft, setDraft] = React.useState<Partial<User>>({});

  React.useEffect(() => {
    if (detail?.user) setDraft({ name: detail.user.name, email: detail.user.email, bio: detail.user.bio, tagline: detail.user.tagline, website: detail.user.website, country: detail.user.country, planId: detail.user.planId });
  }, [detail?.user]);

  const updateUser = useAdminAction(
    (patch: Partial<User>) => adminService.updateUser(userId!, patch, actor, note || undefined),
    { success: 'Changes saved', detail: 'Audit log entry created.', invalidate: [keys.adminUser(userId), keys.adminUsers()] },
  );

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  if (!detail) {
    return (
      <div className="p-6">
        <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="User not found" description="This account may have been deleted." actions={<Button onClick={() => navigate('/admin/users')}>Back to users</Button>} />
      </div>
    );
  }

  const { user, plan, subscription, books, orders, assets, activity, aiUsage, storage } = detail;
  const revenue = orders.filter((order) => order.status === 'completed').reduce((total, order) => total + order.amount, 0);

  return (
    <div>
      <PageHeader title={user.name} description={`${user.email} · joined ${timeAgo(user.createdAt)} · ${user.country || 'country not set'}`}>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => navigate('/admin/users')}><ArrowLeft className="h-3.5 w-3.5" /> All users</Button>
          <Button size="sm" variant="outline" onClick={() => { void emailService.send({ to: user.email, toName: user.name, template: 'system', meta: 'Account check-in' }).then(() => success('Email queued')); }}><Mail className="h-3.5 w-3.5" /> Email</Button>
          <Button size="sm" variant="outline" onClick={() => { void adminService.resetUsage(user.id, actor).then(() => { success('Usage reset'); void refetch(); }); }}><RefreshCcw className="h-3.5 w-3.5" /> Reset usage</Button>
          <Button size="sm" variant={user.status === 'suspended' ? 'default' : 'destructive'} onClick={async () => {
            const ok = await confirm({ title: user.status === 'suspended' ? `Reactivate ${user.name}?` : `Suspend ${user.name}?`, description: user.status === 'suspended' ? 'Access is restored immediately.' : 'They cannot sign in, publish or sell until reactivated.', destructive: user.status !== 'suspended', confirmLabel: user.status === 'suspended' ? 'Reactivate' : 'Suspend' });
            if (ok) updateUser.mutate({ status: user.status === 'suspended' ? 'active' : 'suspended' });
          }}>
            {user.status === 'suspended' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />} {user.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Books" value={formatNumber(books.length)} change={`${books.filter((book) => book.status === 'published').length} published`} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Lifetime revenue" value={formatCurrency(revenue)} change={`${orders.length} orders`} />
        <StatCard label="AI credits" value={formatNumber(user.aiCreditsUsed)} change={`${formatNumber(user.aiImageCreditsUsed)} image credits`} />
        <StatCard label="Storage" value={formatBytes(user.storageUsedBytes)} change={`${assets.length} assets`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Account</CardTitle>
            <CardDescription className="text-xs">Edits are applied through the admin service and logged.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Avatar name={user.name} src={user.avatarUrl} size={44} />
              <StatusPill value={user.role} />
              <StatusPill value={user.status} />
              <Badge variant="outline">{plan?.name ?? user.planId}</Badge>
              {user.emailVerified && <Badge variant="success">Email verified</Badge>}
              {user.isAuthor && <Badge variant="info">Author</Badge>}
              <Badge variant="outline">{subscription?.status ?? 'no subscription'}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="u-name" className="text-xs">Name</Label><Input id="u-name" value={draft.name ?? ''} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="h-9" /></div>
              <div className="space-y-1"><Label htmlFor="u-email" className="text-xs">Email</Label><Input id="u-email" value={draft.email ?? ''} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} className="h-9" /></div>
              <div className="space-y-1"><Label htmlFor="u-tagline" className="text-xs">Tagline</Label><Input id="u-tagline" value={draft.tagline ?? ''} onChange={(event) => setDraft((current) => ({ ...current, tagline: event.target.value }))} className="h-9" /></div>
              <div className="space-y-1"><Label htmlFor="u-website" className="text-xs">Website</Label><Input id="u-website" value={draft.website ?? ''} onChange={(event) => setDraft((current) => ({ ...current, website: event.target.value }))} className="h-9" /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="u-bio" className="text-xs">Bio</Label><textarea id="u-bio" rows={3} value={draft.bio ?? ''} onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              <div className="space-y-1">
                <Label htmlFor="u-plan" className="text-xs">Plan</Label>
                <select id="u-plan" value={draft.planId ?? user.planId} onChange={(event) => setDraft((current) => ({ ...current, planId: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {(plans ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {formatCurrency(entry.priceMonthly)}/mo</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="u-role" className="text-xs">Role</Label>
                <select id="u-role" value={user.role} onChange={(event) => updateUser.mutate({ role: event.target.value as User['role'] })} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {['user', 'moderator', 'admin'].map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="u-note" className="text-xs">Audit note (stored with the change)</Label>
              <Input id="u-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reason for this change" className="h-9" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => updateUser.mutate(draft)} disabled={updateUser.isPending}>{updateUser.isPending ? 'Saving…' : 'Save changes'}</Button>
              <Button size="sm" variant="outline" onClick={() => setDraft({ name: user.name, email: user.email, bio: user.bio, tagline: user.tagline, website: user.website, country: user.country, planId: user.planId })}>Reset form</Button>
              <Button size="sm" variant="ghost" onClick={() => updateUser.mutate({ isAuthor: !user.isAuthor })}><UserCog className="h-3.5 w-3.5" /> {user.isAuthor ? 'Remove author status' : 'Grant author status'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Snapshot</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <KeyValue
              rows={[
                { label: 'Username', value: user.username },
                { label: 'Followers', value: formatNumber(user.followers) },
                { label: 'Following', value: formatNumber(user.following) },
                { label: 'Last active', value: timeAgo(user.lastActiveAt) },
                { label: 'Onboarded', value: user.onboarded ? 'Yes' : 'No' },
                { label: 'Usage period start', value: timeAgo(user.usagePeriodStart) },
                { label: 'Storage quota used', value: storage ? formatBytes(storage.usedBytes) : '—' },
              ]}
            />
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-xs">Two-factor required</span>
              <Switch checked={false} onCheckedChange={() => success('Security policies are managed in Admin → Settings')} />
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={() => { void emailService.send({ to: user.email, toName: user.name, template: 'password-reset' }).then(() => success('Reset link queued')); }}>Send password reset</Button>
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={async () => {
                const ok = await confirm({ title: `Delete ${user.name}?`, description: 'The account, their books, assets and listings are removed. This cannot be undone.', destructive: true, confirmLabel: 'Delete account' });
                if (!ok) return;
                if (user.role === 'admin') { error('Protected account', 'Admin accounts cannot be deleted from the UI.'); return; }
                updateUser.mutate({ status: 'suspended', bio: '[deleted]' });
                success('Account deactivated', 'Hard deletion is intentionally disabled in the demo build.');
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete account
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'overview', label: 'Books', count: books.length },
            { value: 'orders', label: 'Orders', count: orders.length },
            { value: 'ai', label: 'AI usage', count: aiUsage.length },
            { value: 'activity', label: 'Activity', count: activity.length },
            { value: 'assets', label: 'Assets', count: assets.length },
          ]}
        />
        <Card className="mt-3">
          <CardContent className="pt-4">
            {tab === 'overview' && (
              <div className="space-y-2">
                {books.length === 0 && <p className="text-xs text-muted-foreground">No books yet.</p>}
                {books.map((book) => (
                  <div key={book.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{book.title}</p>
                      <p className="text-2xs text-muted-foreground">{formatNumber(book.wordCount)} words · {book.pageCount} pages · updated {timeAgo(book.updatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill value={book.status} />
                      <Link to={`/dashboard/books/${book.id}`} className="rounded border px-2 py-1 text-2xs hover:bg-muted">Open</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'orders' && (
              <div className="space-y-2">
                {orders.length === 0 && <p className="text-xs text-muted-foreground">No orders.</p>}
                {orders.map((order) => (
                  <div key={order.id} className="flex items-center justify-between rounded border p-2 text-xs">
                    <span className="truncate">{order.bookTitle} · {order.id}</span>
                    <span className="flex items-center gap-2"><StatusPill value={order.status} /><span className="font-medium">{formatCurrency(order.amount)}</span></span>
                  </div>
                ))}
              </div>
            )}
            {tab === 'ai' && (
              <div className="space-y-2">
                {aiUsage.length === 0 && <p className="text-xs text-muted-foreground">No AI usage recorded.</p>}
                {aiUsage.map((record) => (
                  <div key={record.id} className="flex items-center justify-between rounded border p-2 text-xs">
                    <span>{record.feature} <span className="text-2xs text-muted-foreground">· {record.model}</span></span>
                    <span className="text-2xs text-muted-foreground">{record.credits} credits · {timeAgo(record.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {tab === 'activity' && (
              <div className="space-y-2">
                {activity.length === 0 && <p className="text-xs text-muted-foreground">No activity recorded.</p>}
                {activity.map((item) => (
                  <div key={item.id} className="rounded border p-2 text-xs">
                    <p>{item.message}</p>
                    <p className="text-2xs text-muted-foreground">{item.type}{item.meta ? ` · ${item.meta}` : ''} · {timeAgo(item.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
            {tab === 'assets' && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {assets.length === 0 && <p className="text-xs text-muted-foreground">No assets uploaded.</p>}
                {assets.map((asset) => (
                  <div key={asset.id} className="overflow-hidden rounded border">
                    <img src={asset.url} alt={asset.name} className="h-24 w-full object-cover" />
                    <p className="truncate p-1 text-2xs">{asset.name}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <ShieldOff className="h-3 w-3" /> Impersonation and destructive deletes are intentionally unavailable in this build.
        <Link to="/admin/audit-logs" className="underline">See this user&apos;s audit trail</Link>
      </div>
    </div>
  );
}
