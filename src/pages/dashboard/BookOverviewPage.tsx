import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BarChart3, BookOpen, Clock, Copy, Download, Eye, FileText, History,
  MessageSquare, PenLine, Rocket, Star, Trash2, Undo2, Users, Sparkles, CheckCircle2, Layers,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator, Switch } from '@/components/ui/primitives';
import { DropdownMenu, Modal, Tabs, type MenuItemDef } from '@/components/ui/overlays';
import { DataTable, EmptyState, ErrorState, Pagination, StatCard, type Column } from '@/components/ui/data';
import { BookCover } from '@/components/shared/BookCard';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useBook, useComments, useVersions } from '@/hooks/queries';
import { bookService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { BOOK_KIND_LABELS, formatNumber, statusLabel, timeAgo } from '@/lib/format';
import { countWords } from '@/lib/utils';
import type { Book, BookPage } from '@/types/domain';

const KIND_ICON: Record<string, string> = {};
void KIND_ICON;

function statusTone(status: Book['status']): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'secondary' {
  switch (status) {
    case 'published': return 'success';
    case 'ready': return 'info';
    case 'in_review': return 'warning';
    case 'archived': return 'secondary';
    case 'trashed': return 'danger';
    default: return 'default';
  }
}

export default function BookOverviewPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast, success, warning } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { data: book, isLoading } = useBook(bookId);
  const { data: comments } = useComments(bookId);
  const { data: versions } = useVersions(bookId);
  const [tab, setTab] = React.useState('overview');
  const [renaming, setRenaming] = React.useState(false);
  const [draftTitle, setDraftTitle] = React.useState('');
  const [draftSubtitle, setDraftSubtitle] = React.useState('');
  const [pagePage, setPagePage] = React.useState(1);
  const perPage = 12;

  const invalidate = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ['book', bookId] });
    qc.invalidateQueries({ queryKey: ['books'] });
    qc.invalidateQueries({ queryKey: ['book-counts'] });
  }, [qc, bookId]);

  const act = useMutation({
    mutationFn: async (action: string) => {
      if (!book || !user) return null;
      switch (action) {
        case 'duplicate': return bookService.duplicate(book.id, user.id, `${book.title} (copy)`);
        case 'archive': return bookService.archive(book.id);
        case 'unarchive': return bookService.unarchive(book.id);
        case 'trash': return bookService.trash(book.id);
        case 'restore': return bookService.restore(book.id);
        case 'pause': return bookService.setVisibility(book.id, book.visibility === 'private' ? 'public' : 'private');
        default: return null;
      }
    },
    onSuccess: (result, action) => {
      invalidate();
      const labels: Record<string, string> = {
        duplicate: 'Book duplicated. Your copy is in Drafts.',
        archive: 'Book archived.',
        unarchive: 'Book returned to Drafts.',
        trash: 'Book moved to Trash.',
        restore: 'Book restored from Trash.',
        pause: `Visibility changed to ${book?.visibility === 'private' ? 'public' : 'private'}.`,
      };
      success(labels[action] ?? 'Done');
      if (action === 'duplicate' && result && typeof result === 'object' && 'id' in result) {
        navigate(`/dashboard/books/${(result as Book).id}`);
      }
    },
    onError: (error: Error) => toast({ title: 'Action failed', description: error.message, variant: 'error' }),
  });

  const rename = useMutation({
    mutationFn: () => bookService.rename(bookId as string, draftTitle, draftSubtitle),
    onSuccess: () => { invalidate(); setRenaming(false); success('Book renamed'); },
    onError: (e: Error) => toast({ title: 'Could not rename', description: e.message, variant: 'error' }),
  });

  const remove = async () => {
    if (!book) return;
    const ok = await confirm({
      title: `Delete “${book.title}” permanently?`,
      description: 'This cannot be undone. Consider moving it to Trash instead.',
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (!ok) return;
    await bookService.remove(book.id);
    invalidate();
    success('Book permanently deleted');
    navigate('/dashboard/books');
  };

  const pages = React.useMemo(() => {
    if (!book) return [] as (BookPage & { sectionTitle: string; index: number })[];
    const bySection = new Map(book.sections.map((section) => [section.id, section.title]));
    return book.pages.map((page, index) => ({
      ...page,
      index,
      sectionTitle: bySection.get(page.sectionId) ?? 'Untitled section',
    }));
  }, [book]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="h-80 animate-pulse rounded-xl bg-muted" />
          <div className="h-80 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <ErrorState
        title="Book not found"
        description="This title may have been deleted, or it belongs to another account."
        onRetry={() => navigate('/dashboard/books')}
        retryLabel="Back to my books"
      />
    );
  }

  const openComments = (comments ?? []).filter((comment) => !comment.resolved).length;
  const readiness = Math.min(100, Math.round(
    (book.pages.length ? 40 : 0) +
    (book.description ? 15 : 0) +
    (book.cover.titleFont ? 15 : 0) +
    (book.toc.enabled ? 10 : 0) +
    (book.metadata.isbn ? 10 : 0) +
    (book.status === 'published' ? 10 : 0),
  ));

  const menuItems: MenuItemDef[] = [
    { id: 'edit', label: 'Open in editor', onSelect: () => navigate(`/dashboard/books/${book.id}/editor`) },
    { id: 'read', label: 'Open reader preview', onSelect: () => navigate(`/read/${book.id}`) },
    { id: 'rename', label: 'Rename / subtitle', onSelect: () => { setDraftTitle(book.title); setDraftSubtitle(book.subtitle); setRenaming(true); } },
    { id: 'duplicate', label: 'Duplicate', onSelect: () => act.mutate('duplicate') },
    { id: 'star', label: book.starred ? 'Remove from starred' : 'Add to starred', onSelect: () => { bookService.toggleStar(book.id); invalidate(); success(book.starred ? 'Removed from starred' : 'Added to starred'); } },
    { id: 'divider-1', label: '', divider: true },
    { id: 'export', label: 'Export book…', onSelect: () => navigate(`/dashboard/exports?book=${book.id}`) },
    { id: 'publish', label: 'Publishing centre', onSelect: () => navigate(`/dashboard/publishing?book=${book.id}`) },
    { id: 'divider-2', label: '', divider: true },
    book.status === 'archived'
      ? { id: 'unarchive', label: 'Unarchive', onSelect: () => act.mutate('unarchive') }
      : { id: 'archive', label: 'Archive', onSelect: () => act.mutate('archive') },
    book.status === 'trashed'
      ? { id: 'restore', label: 'Restore from trash', onSelect: () => act.mutate('restore') }
      : { id: 'trash', label: 'Move to trash', onSelect: () => act.mutate('trash') },
    { id: 'delete', label: 'Delete permanently', destructive: true, onSelect: remove },
  ];

  const pageColumns: Column<BookPage & { sectionTitle: string; index: number }>[] = [
    {
      key: 'index',
      header: '#',
      width: '56px',
      render: (row) => <span className="text-xs text-muted-foreground">{row.index + 1}</span>,
    },
    {
      key: 'title',
      header: 'Page',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.title || 'Untitled page'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.sectionTitle}</p>
        </div>
      ),
    },
    { key: 'layout', header: 'Layout', width: '120px', render: (row) => <Badge variant="outline">{row.layout}</Badge> },
    { key: 'words', header: 'Words', width: '90px', align: 'right', sortable: true, render: (row) => formatNumber(row.wordCount || countWords(row.content)) },
    { key: 'status', header: 'Status', width: '120px', render: (row) => row.locked ? <Badge variant="secondary">Locked</Badge> : row.wordCount > 0 ? <Badge variant="success">Written</Badge> : <Badge variant="outline">Empty</Badge> },
    { key: 'updated', header: 'Updated', width: '140px', render: (row) => <span className="text-xs text-muted-foreground">{timeAgo(row.updatedAt)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard/books')}>
            <ArrowLeft className="h-4 w-4" /> All books
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Badge variant={statusTone(book.status)}>{statusLabel(book.status)}</Badge>
          {book.starred && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/read/${book.id}`)}>
            <Eye className="h-4 w-4" /> Preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/exports?book=${book.id}`)}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/publishing?book=${book.id}`)}>
            <Rocket className="h-4 w-4" /> Publish
          </Button>
          <Button size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>
            <PenLine className="h-4 w-4" /> Open editor
          </Button>
          <DropdownMenu trigger={<Button variant="outline" size="sm">More</Button>} items={menuItems} align="end" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex justify-center bg-muted/40 p-6">
              <BookCover book={book} className="w-[168px] shadow-page" />
            </div>
            <CardContent className="space-y-3 p-4">
              <div>
                <h1 className="font-serif text-lg font-semibold leading-tight">{book.title}</h1>
                {book.subtitle && <p className="text-sm text-muted-foreground">{book.subtitle}</p>}
                <p className="mt-1 text-xs text-muted-foreground">by {book.authorName}</p>
              </div>
              <Separator />
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Type</dt><dd>{BOOK_KIND_LABELS[book.kind]}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Trim size</dt><dd>{book.trimSize.label}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Pages</dt><dd>{formatNumber(book.pageCount)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Words</dt><dd>{formatNumber(book.wordCount)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Visibility</dt><dd className="capitalize">{book.visibility}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Language</dt><dd className="uppercase">{book.language}</dd></div>
              </dl>
              <Separator />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Created</span>
                <span>{timeAgo(book.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Last opened</span>
                <span>{book.lastOpenedAt ? timeAgo(book.lastOpenedAt) : 'Never'}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Publishing readiness</CardTitle>
              <CardDescription className="text-xs">What is left before you can publish.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${readiness}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{readiness}% ready · {book.status === 'published' ? 'already live' : 'not yet published'}</p>
              <ul className="space-y-1.5 text-xs">
                {[
                  { label: 'Written pages', done: book.pages.some((page) => page.wordCount > 0) },
                  { label: 'Book description', done: Boolean(book.description) },
                  { label: 'Cover designed', done: Boolean(book.cover.titleFont) },
                  { label: 'Table of contents', done: book.toc.enabled },
                  { label: 'Metadata complete', done: Boolean(book.metadata.isbn) },
                ].map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <CheckCircle2 className={item.done ? 'h-3.5 w-3.5 text-emerald-500' : 'h-3.5 w-3.5 text-muted-foreground/40'} />
                    <span className={item.done ? 'text-muted-foreground line-through' : ''}>{item.label}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(`/dashboard/publishing?book=${book.id}`)}>
                Open publishing centre
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Pages" value={formatNumber(book.pageCount)} hint={`${book.sections.length} sections`} icon={<Layers className="h-4 w-4" />} />
            <StatCard label="Words" value={formatNumber(book.wordCount)} hint={`${Math.max(1, Math.round(book.wordCount / 250))} min read`} icon={<FileText className="h-4 w-4" />} />
            <StatCard label="Views" value={formatNumber(book.marketplace.views)} hint="Marketplace impressions" icon={<BarChart3 className="h-4 w-4" />} />
            <StatCard label="Rating" value={book.marketplace.rating ? book.marketplace.rating.toFixed(1) : '—'} hint={`${book.marketplace.reviewCount} reviews`} icon={<Star className="h-4 w-4" />} />
          </div>

          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'pages', label: 'Pages', count: book.pages.length },
              { value: 'comments', label: 'Comments', count: openComments },
              { value: 'versions', label: 'Versions', count: versions?.length },
              { value: 'team', label: 'Team' },
            ]}
          />

          {tab === 'overview' && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Description</CardTitle>
                  <CardDescription>Shown on your author page, marketplace listing and exports metadata.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className={book.description ? 'text-sm leading-relaxed text-muted-foreground' : 'text-sm italic text-muted-foreground'}>
                    {book.description || 'No description yet — add one in the editor’s metadata panel.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {book.tags.length === 0 && <span className="text-xs text-muted-foreground">No tags yet</span>}
                    {book.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-2xs">{tag}</Badge>)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">Structure</CardTitle>
                    <CardDescription>{book.sections.length} sections · {book.pages.length} pages</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>
                    <PenLine className="h-4 w-4" /> Edit structure
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {book.sections.length === 0 && <p className="text-sm text-muted-foreground">No sections yet.</p>}
                  {[...book.sections].sort((a, b) => a.order - b.order).map((section) => (
                    <div key={section.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{section.title}</p>
                        <p className="text-xs text-muted-foreground">{section.pageIds.length} pages · {formatNumber(section.wordCount)} words · {section.kind.replace('-', ' ')}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {section.aiGenerated && <Badge variant="accent" className="gap-1 text-2xs"><Sparkles className="h-3 w-3" /> AI</Badge>}
                        <Badge variant={section.status === 'complete' ? 'success' : section.status === 'drafting' ? 'warning' : 'outline'}>{section.status}</Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recent activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[...(versions ?? [])].slice(0, 5).map((version) => (
                    <div key={version.id} className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full bg-muted p-1.5"><History className="h-3.5 w-3.5 text-muted-foreground" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{version.label}</p>
                        <p className="text-xs text-muted-foreground">{version.detail}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(version.createdAt)}</span>
                    </div>
                  ))}
                  {(versions ?? []).length === 0 && <p className="text-sm text-muted-foreground">No version history yet — versions are captured as you edit.</p>}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'pages' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">All pages</CardTitle>
                  <CardDescription>Jump straight into any page in the editor.</CardDescription>
                </div>
                <Button size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>
                  <PenLine className="h-4 w-4" /> Write
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {pages.length === 0 ? (
                  <EmptyState
                    icon={<BookOpen className="h-5 w-5" />}
                    title="No pages yet"
                    description="Add your first chapter in the editor, or generate an outline with AI."
                    actions={<Button size="sm" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>Open editor</Button>}
                  />
                ) : (
                  <>
                    <DataTable
                      columns={pageColumns}
                      rows={pages.slice((pagePage - 1) * perPage, pagePage * perPage)}
                      rowKey={(row) => row.id}
                      onRowClick={(row) => navigate(`/dashboard/books/${book.id}/editor?page=${row.id}`)}
                      dense
                    />
                    {pages.length > perPage && (
                      <Pagination page={pagePage} pageCount={Math.ceil(pages.length / perPage)} onPageChange={setPagePage} />
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {tab === 'comments' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Comments & feedback</CardTitle>
                <CardDescription>Collaborator notes, resolved and open. Manage threads in the editor’s comments panel.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {(comments ?? []).length === 0 && (
                  <EmptyState icon={<MessageSquare className="h-5 w-5" />} title="No comments yet" description="Invite a collaborator or leave yourself a note while writing." />
                )}
                {(comments ?? []).map((comment) => (
                  <div key={comment.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{comment.userName}</p>
                      <div className="flex items-center gap-2">
                        {comment.resolved && <Badge variant="success">Resolved</Badge>}
                        <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{comment.body}</p>
                    {comment.replies.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-l-2 pl-3">
                        {comment.replies.map((reply) => (
                          <div key={reply.id}>
                            <p className="text-xs font-medium">{reply.userName} <span className="font-normal text-muted-foreground">· {timeAgo(reply.createdAt)}</span></p>
                            <p className="text-xs text-muted-foreground">{reply.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => { bookService.resolveComment(comment.id, !comment.resolved); qc.invalidateQueries({ queryKey: ['comments', bookId] }); }}
                      >
                        {comment.resolved ? <Undo2 className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        {comment.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)}>View in editor</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {tab === 'versions' && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Version history</CardTitle>
                  <CardDescription>Restore any checkpoint — restoring mutates the live book.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!user) return;
                    bookService.createVersion(book.id, { id: user.id, name: user.name }, 'Manual checkpoint', `Snapshot with ${book.pageCount} pages`);
                    qc.invalidateQueries({ queryKey: ['versions', bookId] });
                    success('Checkpoint saved');
                  }}
                >
                  Save checkpoint
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {(versions ?? []).length === 0 && <p className="text-sm text-muted-foreground">No versions captured yet.</p>}
                {[...(versions ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((version) => (
                  <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{version.label}</p>
                        <Badge variant={version.kind === 'manual' ? 'info' : version.kind === 'restore' ? 'warning' : 'outline'} className="text-2xs">{version.kind}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {version.detail} · {version.snapshot.pageCount} pages · {formatNumber(version.snapshot.wordCount)} words · {version.userName} · {timeAgo(version.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={version.kind === 'restore'}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Restore “${version.label}”?`,
                          description: 'Your current pages will be replaced by this snapshot. A restore checkpoint is created first.',
                          confirmLabel: 'Restore version',
                        });
                        if (!ok) return;
                        bookService.restoreVersion(version.id);
                        invalidate();
                        qc.invalidateQueries({ queryKey: ['versions', bookId] });
                        success('Version restored');
                      }}
                    >
                      <Undo2 className="h-3 w-3" /> Restore
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {tab === 'team' && <TeamPanel bookId={book.id} />}
        </div>
      </div>

      <Modal open={renaming} onOpenChange={setRenaming} title="Rename book" description="Update the title and subtitle shown throughout Scriptora." footer={
        <>
          <Button variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
          <Button onClick={() => rename.mutate()} disabled={rename.isPending || draftTitle.trim().length < 2}>Save</Button>
        </>
      }>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="book-title">Title</label>
            <Input id="book-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="book-subtitle">Subtitle</label>
            <Input id="book-subtitle" value={draftSubtitle} onChange={(event) => setDraftSubtitle(event.target.value)} placeholder="Optional" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TeamPanel({ bookId }: { bookId: string }) {
  const { user } = useAuth();
  const { success, toast } = useToast();
  const qc = useQueryClient();
  const { data: book } = useBook(bookId);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState<'editor' | 'viewer'>('editor');
  const [busy, setBusy] = React.useState(false);

  const collaborators = bookService.collaborators(bookId);
  const invite = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Enter a valid email', variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      await bookService.inviteCollaborator(bookId, { email, role });
      qc.invalidateQueries({ queryKey: ['collaborators', bookId] });
      success(`Invitation sent to ${email}`);
      setEmail('');
    } catch (error) {
      toast({ title: 'Invite failed', description: (error as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite a collaborator</CardTitle>
          <CardDescription>Editors can write and comment; viewers get read-only access plus comments.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="collab-email">Email address</label>
            <Input id="collab-email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="collaborator@example.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="collab-role">Role</label>
            <select
              id="collab-role"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {['editor', 'viewer'].map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <Button onClick={invite} disabled={busy}><Users className="h-4 w-4" /> Send invite</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">People with access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{user?.name} <span className="text-muted-foreground">(you)</span></p>
              <p className="text-xs text-muted-foreground">Owner · full access</p>
            </div>
            <Badge variant="info">Owner</Badge>
          </div>
          {collaborators.length === 0 && <p className="text-sm text-muted-foreground">No collaborators yet.</p>}
          {collaborators.map((collaborator) => (
            <div key={collaborator.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{collaborator.name || collaborator.email}</p>
                <p className="text-xs text-muted-foreground">{collaborator.email} · {collaborator.status} · invited {timeAgo(collaborator.invitedAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={collaborator.role}
                  onChange={(event) => {
                    bookService.updateCollaborator(collaborator.id, { role: event.target.value as typeof role });
                    qc.invalidateQueries({ queryKey: ['collaborators', bookId] });
                    success('Role updated');
                  }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label={`Role for ${collaborator.email}`}
                >
                  {['editor', 'viewer'].map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    bookService.removeCollaborator(collaborator.id);
                    qc.invalidateQueries({ queryKey: ['collaborators', bookId] });
                    success('Access removed');
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Writing settings</CardTitle>
          <CardDescription>These affect everyone editing this book.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Allow collaborators to edit locked pages', hint: 'Locks are normally respected by every role except the owner.' },
            { label: 'Notify me on new comments', hint: 'Sends an in-app notification and a mock email event.' },
            { label: 'Require review before publishing', hint: 'Reviewers must approve the export before it can go live.' },
          ].map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.hint}</p>
              </div>
              <Switch checked={false} onCheckedChange={() => toast({ title: 'Saved to book preferences', variant: 'default' })} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

