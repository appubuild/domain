import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Download, FileText, Loader2, Package, Printer, RotateCcw, ShieldCheck, Sparkles, Trash2, XCircle, Wrench,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Separator } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { DataTable, EmptyState, ErrorState, ProgressList, StatCard, type Column } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useBooks, useExports, usePreflight } from '@/hooks/queries';
import { exportService, preflightService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { EXPORT_FORMAT_INFO, PUBLISHING_PROFILES } from '@/data/constants';
import { FORMAT_LABELS, formatDateTime, formatNumber } from '@/lib/format';
import { cn, formatBytes } from '@/lib/utils';
import type { ExportFormat, ExportJob, PreflightIssue, PublishingProfileId } from '@/types/domain';
import type { ExportOptions } from '@/lib/exporters';

const FORMAT_ORDER: ExportFormat[] = ['pdf', 'print-pdf', 'epub', 'epub3', 'docx', 'html', 'txt'];

export default function ExportCentrePage() {
  const { user, entitlements } = useAuth();
  const { success, error, warning, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data: books, isLoading: booksLoading } = useBooks({ ownerId: user?.id, status: 'all', sort: 'recent' });
  const bookId = params.get('book') ?? books?.[0]?.id ?? '';
  const profileParam = (params.get('profile') as PublishingProfileId | null) ?? 'digital-pdf';
  const [profileId, setProfileId] = React.useState<PublishingProfileId>(profileParam);
  const [format, setFormat] = React.useState<ExportFormat>('pdf');
  const [options, setOptions] = React.useState<ExportOptions>({ ...exportService.optionsFor(bookId || 'placeholder', profileId) });
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ step: string; progress: number; log: string[] } | null>(null);
  const [lastJob, setLastJob] = React.useState<ExportJob | null>(null);
  const [issues, setIssues] = React.useState<Record<string, PreflightIssue['status']>>({});
  const [viewIssue, setViewIssue] = React.useState<PreflightIssue | null>(null);
  const [fixing, setFixing] = React.useState<string | null>(null);

  const book = books?.find((entry) => entry.id === bookId);
  const profile = preflightService.profile(profileId);
  const isPrint = profile.family === 'print';
  const { data: report, isFetching: preflightLoading, refetch: refetchPreflight } = usePreflight(bookId, profileId, Boolean(bookId));
  const { data: history } = useExports(user?.id, bookId);

  React.useEffect(() => {
    if (!bookId) return;
    setOptions(exportService.optionsFor(bookId, profileId));
  }, [bookId, profileId]);

  React.useEffect(() => {
    if (params.get('book') !== bookId && bookId) {
      const next = new URLSearchParams(params);
      next.set('book', bookId);
      setParams(next, { replace: true });
    }
  }, [bookId, params, setParams]);

  const allowed = book ? entitlements.canExport(format) : false;
  const printLocked = isPrint && !entitlements.canUsePrintProfiles();
  const formatsForProfile = profile.formats.filter((entry): entry is ExportFormat => FORMAT_ORDER.includes(entry as ExportFormat));
  const effIssues = (report?.issues ?? []).map((issue) => ({ ...issue, status: issues[issue.id] ?? issue.status }));
  const openErrors = effIssues.filter((issue) => issue.status === 'open' && issue.severity === 'error').length;
  const openWarnings = effIssues.filter((issue) => issue.status === 'open' && issue.severity === 'warning').length;

  const runExport = async () => {
    if (!book) return;
    if (!allowed) {
      warning('Format not available on your plan', `Upgrade to export ${FORMAT_LABELS[format]}.`);
      return;
    }
    if (printLocked) {
      warning('Print profiles are a Pro feature', 'Upgrade to export press-ready print files.');
      return;
    }
    if (isPrint && openErrors > 0) {
      const ok = await confirm({
        title: `${openErrors} preflight error${openErrors === 1 ? '' : 's'} unresolved`,
        description: 'Print files with unresolved errors may be rejected by the printer. Export anyway?',
        confirmLabel: 'Export anyway',
      });
      if (!ok) return;
    }
    setRunning(true);
    setProgress({ step: 'Starting', progress: 0, log: [] });
    try {
      const job = await exportService.run(book.id, format, profileId, options, (event) => setProgress({ ...event }), user?.id);
      setLastJob(job);
      qc.invalidateQueries({ queryKey: ['exports'] });
      success('Export complete', `${job.fileName} · ${formatBytes(job.fileSizeBytes)} · ${job.pages} pages`);
    } catch (e) {
      error('Export failed', (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const download = (job: ExportJob) => {
    try {
      exportService.download(job.bookId, job.format, { profileId: job.profileId, ...job.options });
      success('Download started', job.fileName);
    } catch (e) {
      error('Could not build file', (e as Error).message);
    }
  };

  const columns: Column<ExportJob>[] = [
    {
      key: 'file',
      header: 'File',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.fileName}</p>
          <p className="truncate text-xs text-muted-foreground">{row.bookTitle}</p>
        </div>
      ),
    },
    { key: 'format', header: 'Format', width: '110px', render: (row) => <Badge variant="outline">{FORMAT_LABELS[row.format]}</Badge> },
    { key: 'family', header: 'Profile', width: '140px', render: (row) => <span className="text-xs">{preflightService.profile(row.profileId).name}</span> },
    { key: 'pages', header: 'Pages', width: '80px', align: 'right', render: (row) => formatNumber(row.pages) },
    { key: 'size', header: 'Size', width: '90px', align: 'right', render: (row) => formatBytes(row.fileSizeBytes) },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (row) => (
        <Badge variant={row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'}>
          {row.status === 'completed' ? 'Ready' : row.status}
        </Badge>
      ),
    },
    { key: 'created', header: 'Created', width: '150px', render: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      width: '96px',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="xs" onClick={() => download(row)} aria-label={`Download ${row.fileName}`}>
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Delete ${row.fileName}`}
            onClick={async () => {
              const ok = await confirm({ title: `Delete ${row.fileName}?`, description: 'The stored file is removed from your export history.', destructive: true, confirmLabel: 'Delete' });
              if (!ok) return;
              exportService.remove(row.id);
              qc.invalidateQueries({ queryKey: ['exports'] });
              success('Export deleted');
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  if (booksLoading) {
    return <div className="space-y-6"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>;
  }

  if (!books || books.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-5 w-5" />}
        title="No books to export yet"
        description="Create a book first — then come back to build PDF, EPUB, DOCX and print files."
        actions={<Button onClick={() => navigate('/dashboard/books/new')}>Create a book</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Export centre</h1>
          <p className="text-sm text-muted-foreground">Build digital and print-ready files, with a preflight check before anything ships.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={bookId}
            onChange={(event) => setParams({ book: event.target.value, profile: profileId })}
            className="h-9 max-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Choose book"
          >
            {books.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${bookId}`)}>Book details</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Exports this session" value={String((history ?? []).length)} hint="Stored in your object store" icon={<Package className="h-4 w-4" />} />
        <StatCard label="Preflight errors" value={String(openErrors)} hint={openErrors ? 'Fix before publishing' : 'All clear'} tone={openErrors ? 'danger' : 'success'} icon={<XCircle className="h-4 w-4" />} />
        <StatCard label="Warnings" value={String(openWarnings)} hint="Usually safe to ignore" tone={openWarnings ? 'warning' : 'default'} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label="Readiness" value={`${report ? Math.round(report.readiness) : 0}%`} hint={profile.name} icon={<ShieldCheck className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Choose a publishing profile</CardTitle>
            <CardDescription>Digital profiles produce reflowable, screen-first files. Print profiles add mirror margins, gutter, bleed and crop marks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {(['digital', 'print', 'platform'] as const).map((family) => (
              <div key={family} className="space-y-2">
                <div className="flex items-center gap-2">
                  {family === 'print' ? <Printer className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {family === 'platform' ? 'Platform-oriented' : `${family} publishing`}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PUBLISHING_PROFILES.filter((entry) => entry.family === family).map((entry) => {
                    const locked = entry.family === 'print' && !entitlements.canUsePrintProfiles();
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          if (locked) { warning('Print profiles are a Pro feature', 'Upgrade to unlock press-ready output.'); return; }
                          setProfileId(entry.id);
                          const nextFormat = entry.formats.find((candidate): candidate is ExportFormat => FORMAT_ORDER.includes(candidate as ExportFormat));
                          if (nextFormat) setFormat(nextFormat);
                        }}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-colors',
                          profileId === entry.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40',
                          locked && 'opacity-60',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{entry.name}</p>
                          {locked && <Badge variant="accent" className="text-2xs">Pro</Badge>}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.description}</p>
                        <p className="mt-1.5 text-2xs uppercase tracking-wide text-muted-foreground">
                          {entry.formats.map((value) => FORMAT_LABELS[value as ExportFormat] ?? value).join(' · ')}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{profile.platformNote}</div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2 · Format</CardTitle>
              <CardDescription>
                {isPrint ? 'Print-ready output. Crop marks and bleed follow your book settings.' : 'Digital output for readers, stores and sharing.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {FORMAT_ORDER.map((entry) => {
                  const meta = EXPORT_FORMAT_INFO[entry];
                  const supported = formatsForProfile.includes(entry);
                  const enabled = entitlements.canExport(entry);
                  return (
                    <button
                      key={entry}
                      type="button"
                      disabled={!supported}
                      onClick={() => setFormat(entry)}
                      className={cn(
                        'rounded-lg border p-2.5 text-left transition-colors',
                        format === entry ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                        !supported && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-medium">{meta?.label ?? FORMAT_LABELS[entry]}</p>
                        {!enabled && <Badge variant="accent" className="text-2xs">Pro</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{meta?.description}</p>
                    </button>
                  );
                })}
              </div>
              <Separator />
              <div className="space-y-2">
                {([
                  ['includeCover', 'Include cover page'],
                  ['includeToc', 'Include table of contents'],
                  ['embedFonts', 'Embed fonts'],
                  ['highResImages', 'High-resolution images'],
                  ['cropMarks', isPrint ? 'Crop marks and bleed' : 'Crop marks (print only)'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm">
                    <span>{label}</span>
                    <Checkbox checked={Boolean(options[key])} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: checked }))} />
                  </label>
                ))}
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Estimated size</span><span>{formatBytes(exportService.estimateSize(bookId, format, profileId))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pages</span><span>{formatNumber(book?.pageCount ?? 0)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Words</span><span>{formatNumber(book?.wordCount ?? 0)}</span></div>
              </div>
              {!allowed && (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="font-medium">{FORMAT_LABELS[format]} exports are not in your plan.</p>
                  <Button variant="outline" size="xs" className="mt-2" onClick={() => navigate('/dashboard/subscription')}>
                    <Sparkles className="h-3 w-3" /> Compare plans
                  </Button>
                </div>
              )}
              <Button className="w-full" onClick={runExport} disabled={running || !allowed}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {running ? 'Exporting…' : `Export ${FORMAT_LABELS[format]}`}
              </Button>
              {progress && (
                <div className="space-y-2">
                  <ProgressList items={[{ label: progress.step, value: progress.progress }]} />
                  {progress.log.length > 0 && (
                    <pre className="max-h-28 overflow-auto rounded-md bg-muted p-2 text-2xs leading-relaxed text-muted-foreground">
                      {progress.log.join('\n')}
                    </pre>
                  )}
                </div>
              )}
              {lastJob?.status === 'completed' && !running && (
                <Button variant="outline" className="w-full" onClick={() => download(lastJob)}>
                  <Download className="h-4 w-4" /> Download {lastJob.fileName}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">3 · Preflight</CardTitle>
            <CardDescription>
              {profile.name} · checks page size, margins, bleed, gutter, images, fonts, TOC and metadata.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchPreflight()} disabled={preflightLoading}>
            {preflightLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Re-run
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report && preflightLoading && <div className="h-32 animate-pulse rounded-lg bg-muted" />}
          {report && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Passed</p>
                  <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{report.passed}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Warnings</p>
                  <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{openWarnings}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Errors</p>
                  <p className="text-lg font-semibold text-rose-600 dark:text-rose-400">{openErrors}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Readiness</p>
                  <p className="text-lg font-semibold">{Math.round(report.readiness)}%</p>
                </div>
              </div>
              <div className="space-y-2">
                {effIssues.length === 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" /> No issues found — this file is ready to export.
                  </div>
                )}
                {effIssues.map((issue) => (
                  <div key={issue.id} className={cn('rounded-lg border p-3', issue.status !== 'open' && 'opacity-60')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {issue.severity === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" /> : issue.severity === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{issue.title}</p>
                          <p className="text-xs text-muted-foreground">{issue.detail}</p>
                          <p className="mt-1 text-2xs uppercase tracking-wide text-muted-foreground">{issue.category}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {issue.status !== 'open' ? (
                          <Badge variant={issue.status === 'fixed' ? 'success' : 'secondary'}>{issue.status}</Badge>
                        ) : (
                          <>
                            {issue.autoFixable && (
                              <Button
                                variant="outline"
                                size="xs"
                                disabled={fixing === issue.id}
                                onClick={async () => {
                                  setFixing(issue.id);
                                  try {
                                    const result = await preflightService.applyFix(bookId, issue, profileId);
                                    if (result.applied) {
                                      setIssues((current) => ({ ...current, [issue.id]: 'fixed' }));
                                      success(result.message);
                                      refetchPreflight();
                                    } else {
                                      info(result.message);
                                    }
                                  } catch (e) {
                                    error('Fix failed', (e as Error).message);
                                  } finally {
                                    setFixing(null);
                                  }
                                }}
                              >
                                {fixing === issue.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />} Fix
                              </Button>
                            )}
                            <Button variant="ghost" size="xs" onClick={() => setIssues((current) => ({ ...current, [issue.id]: 'ignored' }))}>Ignore</Button>
                            <Button variant="ghost" size="xs" onClick={() => setViewIssue(issue)}>View issue</Button>
                          </>
                        )}
                      </div>
                    </div>
                    {issue.status === 'open' && <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Hint:</span> {issue.fixHint}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export history</CardTitle>
          <CardDescription>Every file built for this book, stored in your object storage bucket.</CardDescription>
        </CardHeader>
        <CardContent>
          {(history ?? []).length === 0 ? (
            <EmptyState icon={<Package className="h-5 w-5" />} title="No exports yet" description="Your generated files will appear here with size, page count and a download button." />
          ) : (
            <DataTable columns={columns} rows={history ?? []} rowKey={(row) => row.id} dense />
          )}
        </CardContent>
      </Card>

      <Modal
        open={Boolean(viewIssue)}
        onOpenChange={(open) => !open && setViewIssue(null)}
        title={viewIssue?.title ?? 'Issue'}
        description={viewIssue ? `${viewIssue.category} · ${viewIssue.severity}` : undefined}
        footer={<Button variant="outline" onClick={() => setViewIssue(null)}>Close</Button>}
      >
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">{viewIssue?.detail}</p>
          <div className="rounded-lg bg-muted/60 p-3 text-xs">
            <p className="font-medium">Suggested fix</p>
            <p className="mt-1 text-muted-foreground">{viewIssue?.fixHint}</p>
          </div>
          {viewIssue?.pageId && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${bookId}/editor?page=${viewIssue.pageId}`)}>
              Open the affected page
            </Button>
          )}
        </div>
      </Modal>

    </div>
  );
}
