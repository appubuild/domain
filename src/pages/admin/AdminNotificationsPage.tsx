import * as React from 'react';
import { Bell, Check, Plus, Send, Trash2, Users } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminUsers, useEmails, keys } from '@/hooks/queries';
import { notificationService, emailService } from '@/services';
import { getDatabase } from '@/store/db';
import { formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, FilterSelect, StatusPill, Toolbar } from './shared';
import type { AppNotification, NotificationType } from '@/types/domain';

const TEMPLATES: { type: NotificationType; label: string; body: string }[] = [
  { type: 'publishing', label: 'Publishing update', body: 'Your book finished publishing and is live in the marketplace.' },
  { type: 'sale', label: 'New sale', body: 'You made a sale. Open your earnings to see the breakdown.' },
  { type: 'ai', label: 'AI credits running low', body: 'You have used 80% of this month’s AI credits. Upgrade for more.' },
  { type: 'comment', label: 'New comment', body: 'A collaborator left a comment on your manuscript.' },
  { type: 'system', label: 'Platform maintenance', body: 'Scriptora will be briefly unavailable for scheduled maintenance.' },
  { type: 'sale', label: 'Milestone reached', body: 'Congratulations — your book passed 1,000 readers.' },
];

export default function AdminNotificationsPage() {
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: users } = useAdminUsers({ sort: 'recent' });
  const { data: emails, refetch: refetchEmails } = useEmails();
  const [tab, setTab] = React.useState<'broadcast' | 'inbox' | 'history'>('broadcast');
  const [audience, setAudience] = React.useState('all');
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ title: 'Welcome to Scriptora Pro', body: 'Your upgrade is live — enjoy unlimited books, premium templates and print-ready exports.', link: '/dashboard', template: TEMPLATES[0], sendEmail: true });
  const [sentLog, setSentLog] = React.useState<{ id: string; title: string; audience: string; recipients: number; at: string; email: boolean }[]>([]);

  const notifications = React.useMemo(() => {
    const db = getDatabase();
    return db.notifications.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tab, composeOpen]);

  const broadcast = useAdminAction(
    async () => {
      const db = getDatabase();
      const recipients = audience === 'all' ? db.users : db.users.filter((user) => user.planId === audience || user.role === audience);
      await Promise.all(
        recipients.map((user) =>
          notificationService.push(user.id, { type: draft.template.type, title: draft.title, body: draft.body, link: draft.link, priority: 'normal' }),
        ),
      );
      if (draft.sendEmail) {
        await Promise.all(recipients.slice(0, 40).map((user) => emailService.send({ to: user.email, toName: user.name, template: 'system', meta: draft.title })));
      }
      setSentLog((current) => [{ id: `log_${Date.now()}`, title: draft.title, audience, recipients: recipients.length, at: new Date().toISOString(), email: draft.sendEmail }, ...current]);
      return recipients.length;
    },
    { success: 'Broadcast sent', detail: 'Notifications land in the in-app centre; email events are queued.', invalidate: [keys.emails] },
  );

  const unread = notifications.filter((entry) => !entry.read).length;

  return (
    <div>
      <PageHeader title="Notifications" description="Broadcast product news, manage the in-app centre and inspect every email the platform sends.">
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setComposeOpen(true)}><Plus className="h-3.5 w-3.5" /> Compose broadcast</Button>
          <Button size="sm" variant="outline" onClick={() => void refetchEmails()}>Refresh log</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Notifications stored" value={formatNumber(notifications.length)} icon={<Bell className="h-4 w-4" />} />
        <StatCard label="Unread" value={formatNumber(unread)} />
        <StatCard label="Email events" value={formatNumber((emails ?? []).length)} icon={<Send className="h-4 w-4" />} />
        <StatCard label="Failed emails" value={formatNumber((emails ?? []).filter((event) => event.status === 'failed').length)} />
      </div>

      <Tabs
        className="mt-4"
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        size="sm"
        tabs={[
          { value: 'broadcast', label: 'Broadcast' },
          { value: 'inbox', label: 'In-app centre', count: notifications.length },
          { value: 'history', label: 'Send history', count: sentLog.length },
        ]}
      />

      {tab === 'broadcast' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr,340px]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Compose</CardTitle>
              <CardDescription className="text-xs">Queued instantly — no deploy, no waiting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="n-title" className="text-xs">Title</Label><Input id="n-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="space-y-1.5"><Label htmlFor="n-body" className="text-xs">Body</Label><textarea id="n-body" rows={4} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="n-link" className="text-xs">Deep link</Label><Input id="n-link" value={draft.link} onChange={(event) => setDraft((current) => ({ ...current, link: event.target.value }))} /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="n-template" className="text-xs">Notification type</Label>
                  <select id="n-template" value={draft.template.type} onChange={(event) => setDraft((current) => ({ ...current, template: TEMPLATES.find((entry) => entry.type === event.target.value) ?? current.template }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                    {TEMPLATES.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-center justify-between rounded border p-2 text-xs">Also send an email <Switch checked={draft.sendEmail} onCheckedChange={(checked) => setDraft((current) => ({ ...current, sendEmail: checked }))} /></label>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" disabled={broadcast.isPending} onClick={() => broadcast.mutate(undefined)}>
                  <Send className="h-3.5 w-3.5" /> {broadcast.isPending ? 'Sending…' : `Send to ${audienceLabel(audience, users?.length ?? 0)}`}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { const first = notifications[0]; if (first) { notificationService.remove(first.id); success('Oldest notification removed'); } }}>Trim oldest</Button>
                <Button size="sm" variant="ghost" onClick={() => info('Test send', 'A single notification is pushed to the demo account.')}>Send test</Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Audience</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <FilterSelect label="Audience" value={audience} onChange={setAudience} options={[
                  { value: 'all', label: `Everyone (${users?.length ?? 0})` },
                  { value: 'plan_free', label: 'Free plan' },
                  { value: 'plan_pro', label: 'Pro plan' },
                  { value: 'plan_business', label: 'Business plan' },
                  { value: 'author', label: 'Roles: authors' },
                  { value: 'admin', label: 'Roles: admins' },
                ]} />
                <p className="text-2xs text-muted-foreground">Segments resolve against the live user table, so new signups are included automatically.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Templates</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {TEMPLATES.map((entry) => (
                  <button key={entry.type} type="button" onClick={() => setDraft((current) => ({ ...current, template: entry, title: entry.label, body: entry.body }))} className="w-full rounded border p-2 text-left text-2xs hover:border-primary/50">
                    <span className="block font-medium">{entry.label}</span>
                    <span className="block text-muted-foreground">{entry.body}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'inbox' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">In-app notification centre</CardTitle>
            <CardDescription className="text-xs">Everything users see behind the bell icon.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {notifications.slice(0, 30).map((entry: AppNotification) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{entry.title} {!entry.read && <Badge variant="info" className="ml-1 text-2xs">unread</Badge>}</p>
                  <p className="line-clamp-1 text-2xs text-muted-foreground">{entry.body} · {timeAgo(entry.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-2xs">{entry.type}</Badge>
                  <Button size="xs" variant="ghost" onClick={() => { notificationService.markRead(entry.id); success('Marked read'); setSentLog((current) => [...current]); }}>Read</Button>
                  <Button size="xs" variant="ghost" onClick={() => { notificationService.remove(entry.id); success('Notification removed'); setSentLog((current) => [...current]); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
            {notifications.length === 0 && <EmptyState icon={<Bell className="h-5 w-5" />} title="No notifications yet" description="Broadcasts and system events land here." />}
            {notifications.length > 0 && (
              <>
                <Separator />
                <div className="flex gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => { const db = getDatabase(); db.users.forEach((user) => notificationService.markAllRead(user.id)); success('Inbox cleared for every user'); }}><Check className="h-3 w-3" /> Mark all read</Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirm({ title: 'Clear every notification?', description: 'Users lose their notification history. This cannot be undone.', destructive: true, confirmLabel: 'Clear all' });
                      if (ok) { getDatabase().users.forEach((user) => notificationService.clear(user.id)); success('Notification centre cleared'); }
                    }}
                  >
                    Clear everyone&apos;s inbox
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'history' && (
        <Card className="mt-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Broadcast history</CardTitle>
            <CardDescription className="text-xs">Recorded this session; the email log below persists.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sentLog.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
                <span className="min-w-0 truncate">{entry.title}</span>
                <span className="flex items-center gap-2 text-2xs text-muted-foreground">
                  <Users className="h-3 w-3" /> {entry.recipients} recipients · {audienceLabel(entry.audience, 0)} · {entry.email ? 'email + in-app' : 'in-app only'} · {timeAgo(entry.at)}
                </span>
              </div>
            ))}
            {sentLog.length === 0 && <p className="text-xs text-muted-foreground">No broadcasts sent in this session yet.</p>}
          </CardContent>
        </Card>
      )}

      <Modal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        title="Compose broadcast"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button onClick={() => { setComposeOpen(false); setTab('broadcast'); }}>Continue in composer</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="m-title" className="text-xs">Title</Label><Input id="m-title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="m-body" className="text-xs">Body</Label><textarea id="m-body" rows={4} value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
          <div className="flex flex-wrap gap-1.5">
            <FilterSelect label="Audience" value={audience} onChange={setAudience} options={[{ value: 'all', label: 'Everyone' }, { value: 'plan_pro', label: 'Pro plan' }, { value: 'author', label: 'Authors' }]} />
            <label className="flex items-center gap-2 rounded border px-2 text-xs">Email too <Switch checked={draft.sendEmail} onCheckedChange={(checked) => setDraft((current) => ({ ...current, sendEmail: checked }))} /></label>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-2xs text-muted-foreground">Preview</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><Bell className="h-3.5 w-3.5" /> {draft.title}</p>
            <p className="text-xs text-muted-foreground">{draft.body}</p>
            {draft.link && <p className="mt-1 text-2xs text-primary underline">{draft.link}</p>}
          </div>
          <p className="text-2xs text-muted-foreground">Recipients receive an in-app notification immediately{`, and an email through the mock provider when enabled` }.</p>
        </div>
      </Modal>

      <p className="mt-3 text-2xs text-muted-foreground">Email delivery details live in <StatusPill value="email log" /> below and on the dedicated Email screen.</p>
    </div>
  );
}

function audienceLabel(audience: string, fallback: number) {
  if (audience === 'all') return `everyone${fallback ? ` (${fallback})` : ''}`;
  if (audience.startsWith('plan_')) return `${audience.replace('plan_', '')} plan subscribers`;
  return `${audience}s`;
}
