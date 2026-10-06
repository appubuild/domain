import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Flag, ShieldQuestion, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator, Textarea } from '@/components/ui/primitives';
import { Modal, Tabs } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useReports, keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterSelect, StatusPill, Toolbar } from './shared';
import type { Report } from '@/types/domain';

const REASONS = [
  { value: 'all', label: 'All reasons' },
  { value: 'spam', label: 'Spam' },
  { value: 'copyright', label: 'Copyright' },
  { value: 'offensive', label: 'Offensive content' },
  { value: 'misinformation', label: 'Misinformation' },
  { value: 'plagiarism', label: 'Plagiarism' },
  { value: 'other', label: 'Other' },
];

export default function AdminReportsPage() {
  const actor = useAdminActor();
  const { success } = useToast();
  const { data: reports, isLoading, refetch } = useReports();
  const [tab, setTab] = React.useState<'open' | 'investigating' | 'closed'>('open');
  const [reason, setReason] = React.useState('all');
  const [detail, setDetail] = React.useState<Report | null>(null);
  const [note, setNote] = React.useState('');

  const resolve = useAdminAction(
    ({ id, status, note: resolutionNote }: { id: string; status: Report['status']; note: string }) => adminService.resolveReport(id, status, resolutionNote, actor),
    { success: 'Report updated', detail: 'Reporter and moderator notes are stored.', invalidate: [keys.reports] },
  );

  const rows = React.useMemo(() => {
    const list = (reports ?? []) as Report[];
    const filtered = list.filter((report) => (reason === 'all' || report.reason === reason));
    if (tab === 'open') return filtered.filter((report) => report.status === 'open');
    if (tab === 'investigating') return filtered.filter((report) => report.status === 'investigating');
    return filtered.filter((report) => report.status === 'resolved' || report.status === 'dismissed');
  }, [reason, reports, tab]);

  const all = (reports ?? []) as Report[];

  const columns: Column<Report>[] = [
    {
      key: 'target',
      header: 'Reported content',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{row.targetLabel}</p>
          <p className="truncate text-2xs capitalize text-muted-foreground">{row.targetType} · reported by {row.reporterName}</p>
        </div>
      ),
    },
    { key: 'reason', header: 'Reason', render: (row) => <Badge variant="outline" className="text-2xs capitalize">{row.reason}</Badge> },
    { key: 'details', header: 'Details', render: (row) => <span className="line-clamp-2 text-2xs text-muted-foreground">{row.details}</span> },
    { key: 'status', header: 'Status', render: (row) => <StatusPill value={row.status} /> },
    { key: 'createdAt', header: 'Reported', align: 'right', render: (row) => <span className="text-2xs text-muted-foreground">{timeAgo(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={() => { setDetail(row); setNote(row.adminNote ?? ''); }}>Open</Button>
          {row.status === 'open' && <Button size="xs" variant="outline" onClick={() => resolve.mutate({ id: row.id, status: 'investigating', note: 'Review started' })}>Investigate</Button>}
          {row.status !== 'resolved' && <Button size="xs" variant="ghost" onClick={() => resolve.mutate({ id: row.id, status: 'resolved', note: note || 'Action taken' })}><CheckCircle2 className="h-3 w-3" /></Button>}
          {row.status !== 'dismissed' && <Button size="xs" variant="ghost" onClick={() => resolve.mutate({ id: row.id, status: 'dismissed', note: 'No violation found' })}><XCircle className="h-3 w-3" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Reports" description="Reader and author reports about books, reviews, authors and content. Every decision is auditable.">
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Refresh queue</Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open" value={String(all.filter((report) => report.status === 'open').length)} icon={<Flag className="h-4 w-4" />} />
        <StatCard label="Investigating" value={String(all.filter((report) => report.status === 'investigating').length)} icon={<ShieldQuestion className="h-4 w-4" />} />
        <StatCard label="Resolved" value={String(all.filter((report) => report.status === 'resolved').length)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Dismissed" value={String(all.filter((report) => report.status === 'dismissed').length)} icon={<XCircle className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
          size="sm"
          tabs={[
            { value: 'open', label: 'Open', count: all.filter((report) => report.status === 'open').length },
            { value: 'investigating', label: 'Investigating', count: all.filter((report) => report.status === 'investigating').length },
            { value: 'closed', label: 'Closed', count: all.filter((report) => report.status === 'resolved' || report.status === 'dismissed').length },
          ]}
        />
        <FilterSelect label="Reason" value={reason} onChange={setReason} options={REASONS} />
      </Toolbar>

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyState={<EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing here" description={tab === 'open' ? 'The report queue is clear.' : 'No reports in this view.'} />}
          />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Report categories explained</CardTitle>
          <CardDescription className="text-xs">What each reason means for the moderation decision.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-2xs sm:grid-cols-2">
          <p><strong className="font-medium">Spam</strong> — promotional or repetitive content; hide the review or unpublish the listing.</p>
          <p><strong className="font-medium">Copyright</strong> — verify ownership before removing; escalate to legal if the claim is credible.</p>
          <p><strong className="font-medium">Offensive</strong> — remove content that violates the community guidelines.</p>
          <p><strong className="font-medium">Misinformation</strong> — add a note or hide when a factual claim is unsafe.</p>
          <p><strong className="font-medium">Plagiarism</strong> — compare against the catalogue; suspend the account on repeat offences.</p>
          <p><strong className="font-medium">Other</strong> — investigate, then resolve or dismiss with a note.</p>
          <Separator className="sm:col-span-2" />
          <p className="text-muted-foreground sm:col-span-2">Content actions live in <Link to="/admin/books" className="underline">Books</Link> and <Link to="/admin/reviews" className="underline">Reviews</Link>; account actions live in <Link to="/admin/users" className="underline">Users</Link>.</p>
        </CardContent>
      </Card>

      <Modal
        open={Boolean(detail)}
        onOpenChange={(next) => !next && setDetail(null)}
        title={detail ? `Report: ${detail.targetLabel}` : 'Report'}
        description={detail ? `${detail.reason} · ${detail.targetType} · ${formatDateTime(detail.createdAt)}` : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
            {detail && <Button onClick={() => { resolve.mutate({ id: detail.id, status: 'resolved', note: note || 'Action taken' }); setDetail(null); }}>Resolve</Button>}
            {detail && <Button variant="ghost" onClick={() => { resolve.mutate({ id: detail.id, status: 'dismissed', note: note || 'No violation found' }); setDetail(null); }}>Dismiss</Button>}
          </>
        }
      >
        {detail && (
          <div className="space-y-3">
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {detail.details}
            </p>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Reporter</span><span>{detail.reporterName}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Status</span><StatusPill value={detail.status} /></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Target ID</span><span className="font-mono text-2xs">{detail.targetId}</span></p>
              <p className="flex justify-between border-b py-1"><span className="text-muted-foreground">Reported</span><span>{timeAgo(detail.createdAt)}</span></p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="report-note" className="text-xs font-medium">Resolution note</label>
              <Textarea id="report-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you find and what did you do?" />
              <div className="flex flex-wrap gap-1.5">
                {['No violation found', 'Content hidden', 'Author warned', 'Booking unpublished', 'Account suspended pending review'].map((preset) => (
                  <button key={preset} type="button" onClick={() => setNote(preset)} className="rounded border px-2 py-0.5 text-2xs hover:border-primary/50">{preset}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
