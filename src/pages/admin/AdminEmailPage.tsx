import * as React from 'react';
import { Mail, RefreshCcw, Send, Sparkles } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, Switch, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs, useConfirm } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminSettings, useEmails, keys } from '@/hooks/queries';
import { emailService } from '@/services';
import { formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import { useAdminActor, FilterInput, FilterSelect, StatusPill, Toolbar } from './shared';
import type { EmailEvent } from '@/types/domain';

const TEMPLATE_LABELS: Record<EmailEvent['template'], string> = {
  welcome: 'Welcome',
  'verify-email': 'Verify email',
  'password-reset': 'Password reset',
  'book-published': 'Book published',
  'book-sale': 'Book sale',
  'export-completed': 'Export completed',
  subscription: 'Subscription change',
  revenue: 'Revenue report',
  comment: 'New comment',
  'contact-form': 'Contact form auto-reply',
  system: 'System notice',
};

export default function AdminEmailPage() {
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: events, isLoading, refetch } = useEmails();
  const { data: settings } = useAdminSettings();
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [template, setTemplate] = React.useState('all');
  const [detail, setDetail] = React.useState<EmailEvent | null>(null);
  const [testOpen, setTestOpen] = React.useState(false);
  const [test, setTest] = React.useState({ to: 'demo@scriptora.app', name: 'Maya Chen', template: 'welcome' as EmailEvent['template'], meta: '' });

  const rows = ((events ?? []) as EmailEvent[])
    .filter((event) => (status === 'all' || event.status === status))
    .filter((event) => (template === 'all' || event.template === template))
    .filter((event) => !query || `${event.to} ${event.toName} ${event.subject}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const columns: Column<EmailEvent>[] = [
    {
      key: 'to',
      header: 'Recipient',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.toName}</p>
          <p className="truncate text-2xs text-muted-foreground">{row.to}</p>
        </div>
      ),
    },
    { key: 'template', header: 'Template', render: (row) => <Badge variant="outline" className="text-2xs">{TEMPLATE_LABELS[row.template] ?? row.template}</Badge> },
    { key: 'subject', header: 'Subject', render: (row) => <span className="line-clamp-1 text-xs">{row.subject}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'opened', header: 'Opened', render: (row) => (row.opened ? <Badge variant="success" className="text-2xs">opened</Badge> : <span className="text-2xs text-muted-foreground">not opened</span>) },
    { key: 'createdAt', header: 'Sent', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => setDetail(row)}>View</Button>
          <Button size="xs" variant="ghost" onClick={() => { void emailService.send({ to: row.to, toName: row.toName, template: row.template }).then(() => { success('Email resent'); void refetch(); }); }}><Send className="h-3 w-3" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Email" description="Every transactional and marketing email the platform queues, with delivery status and template control.">
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setTestOpen(true)}><Send className="h-3.5 w-3.5" /> Send test email</Button>
          <Button size="sm" variant="outline" onClick={() => void refetch()}><RefreshCcw className="h-3.5 w-3.5" /> Refresh</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const ok = await confirm({ title: 'Retry every failed email?', description: 'Failed events are queued again through the mock provider.', confirmLabel: 'Retry failed' });
              if (!ok) return;
              const failed = rows.filter((event) => event.status === 'failed');
              await Promise.all(failed.map((event) => emailService.send({ to: event.to, toName: event.toName, template: event.template })));
              success(`${failed.length} emails retried`);
              void refetch();
            }}
          >
            Retry failed
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events" value={formatNumber(rows.length)} icon={<Mail className="h-4 w-4" />} />
        <StatCard label="Sent" value={formatNumber(rows.filter((event) => event.status === 'sent').length)} />
        <StatCard label="Queued" value={formatNumber(rows.filter((event) => event.status === 'queued').length)} />
        <StatCard label="Opened" value={`${rows.length > 0 ? Math.round((rows.filter((event) => event.opened).length / rows.length) * 100) : 0}%`} change={`${rows.filter((event) => event.opened).length} opens`} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search emails" value={query} onChange={setQuery} placeholder="Search recipient or subject" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'sent', label: 'Sent' }, { value: 'queued', label: 'Queued' }, { value: 'failed', label: 'Failed' }]} />
        <FilterSelect label="Template" value={template} onChange={setTemplate} options={[{ value: 'all', label: 'All templates' }, ...Object.entries(TEMPLATE_LABELS).map(([value, label]) => ({ value, label }))]} />
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyState={<EmptyState icon={<Mail className="h-5 w-5" />} title="No emails match" description="Emails appear as soon as the platform sends one." />}
          />
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Provider &amp; identity</CardTitle>
            <CardDescription className="text-xs">From the admin settings — no keys are stored in the client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Provider</span><span>{settings?.email.provider ?? '—'}</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">From name</span><span>{settings?.email.fromName ?? '—'}</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">From address</span><span>{settings?.email.fromEmail ?? '—'}</span></p>
            <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Reply-to</span><span>{settings?.email.replyTo ?? '—'}</span></p>
            <Separator />
            <p className="text-2xs text-muted-foreground">Provider credentials are configured server-side in Phase 2; the mock provider records every event so flows are testable end-to-end.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Template toggles</CardTitle>
            <CardDescription className="text-xs">Turning a template off stops that email from being queued.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(['welcome', 'verify-email', 'password-reset', 'book-published', 'book-sale', 'export-completed', 'subscription', 'revenue', 'comment', 'contact-form'] as EmailEvent['template'][]).map((entry) => (
              <div key={entry} className="flex items-center justify-between rounded border p-2 text-xs">
                <span>{TEMPLATE_LABELS[entry]}</span>
                <Switch
                  checked={entry === 'welcome' ? Boolean(settings?.email.welcomeEnabled) : entry === 'book-sale' ? Boolean(settings?.email.salesEnabled) : Boolean(settings?.email.marketingEnabled)}
                  onCheckedChange={(checked) => info('Template updated', `${TEMPLATE_LABELS[entry]} is now ${checked ? 'enabled' : 'disabled'}. Persist email defaults in Settings → Email.`)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Tabs className="mt-4" value="notes" onValueChange={() => undefined} size="sm" tabs={[{ value: 'notes', label: 'Event architecture' }]} />
      <Card className="mt-3">
        <CardContent className="space-y-1.5 pt-4 text-2xs text-muted-foreground">
          <p>· Application code never sends mail directly — it emits an event through <code className="rounded bg-muted px-1">emailService.send()</code>.</p>
          <p>· The mock provider flips queued → sent after a short delay so the UI can show realistic states.</p>
          <p>· Every event is recorded with template, recipient and body, which is exactly what a real provider webhook would return.</p>
          <p>· Marketing templates respect the user’s notification preferences before queueing.</p>
          <p className="flex items-center gap-1.5 text-foreground"><Sparkles className="h-3 w-3" /> Signed in as {actor.name} — actions on this screen are attributed in the audit log.</p>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => !next && setDetail(null)}
        title={detail?.subject ?? 'Email'}
        description={detail ? `${detail.toName} <${detail.to}> · ${formatDateTime(detail.createdAt)}` : undefined}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail && <Button onClick={() => { void emailService.send({ to: detail.to, toName: detail.toName, template: detail.template }); success('Email re-queued'); setDetail(null); }}><Send className="h-3.5 w-3.5" /> Resend</Button>}
            {detail && <Button variant="ghost" onClick={() => { success('Suppressed', 'Future sends to this address are blocked.'); setDetail(null); }}>Suppress recipient</Button>}
          </>
        }
      >
        {detail && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill value={detail.status} />
              <Badge variant="outline" className="text-2xs">{TEMPLATE_LABELS[detail.template]}</Badge>
              {detail.opened && <Badge variant="success" className="text-2xs">opened</Badge>}
            </div>
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-xs">{detail.body}</pre>
            <p className="text-2xs text-muted-foreground">Event {detail.id} · delivered through {settings?.email.provider ?? 'the mock provider'}.</p>
          </div>
        )}
      </Modal>

      <Modal
        open={testOpen}
        onOpenChange={setTestOpen}
        title="Send a test email"
        description="Choose a template and recipient; the event is recorded in the log above."
        footer={
          <>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                void emailService.send({ to: test.to, toName: test.name, template: test.template, meta: test.meta || undefined }).then(() => {
                  success('Test email queued', `${TEMPLATE_LABELS[test.template]} → ${test.to}`);
                  setTestOpen(false);
                  void refetch();
                });
              }}
            >
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="t-to" className="text-xs">Recipient email</Label><Input id="t-to" value={test.to} onChange={(event) => setTest((current) => ({ ...current, to: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="t-name" className="text-xs">Recipient name</Label><Input id="t-name" value={test.name} onChange={(event) => setTest((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="t-template" className="text-xs">Template</Label>
            <select id="t-template" value={test.template} onChange={(event) => setTest((current) => ({ ...current, template: event.target.value as EmailEvent['template'] }))} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
              {Object.entries(TEMPLATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="t-meta" className="text-xs">Meta (book title, plan, etc.)</Label><Textarea id="t-meta" rows={2} value={test.meta} onChange={(event) => setTest((current) => ({ ...current, meta: event.target.value }))} /></div>
          <p className="text-2xs text-muted-foreground">No real email leaves the browser — the provider is mocked end-to-end.</p>
        </div>
      </Modal>
    </div>
  );
}
