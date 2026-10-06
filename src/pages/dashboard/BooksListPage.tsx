import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useBooks, useBookCounts, useCategories } from '@/hooks/queries';
import { bookService, exportService, templateService } from '@/services';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { Seo } from '@/components/shared/Seo';
import { PageHeader } from '@/components/layout/AdminLayout';
import { BookCover } from '@/components/shared/BookCard';
import { Badge, Button, Card, Input, Rating, Select, Skeleton, Tooltip } from '@/components/ui/primitives';
import { DataTable, EmptyState, ErrorState, Pagination, type Column } from '@/components/ui/data';
import { Modal, DropdownMenu, type MenuItemDef } from '@/components/ui/overlays';
import { formatDate, formatNumber, statusLabel, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Book, BookStatus } from '@/types/domain';

const VIEWS: {
  id: string;
  label: string;
  status: BookStatus | 'all';
  visibility?: Book['visibility'];
  starred?: boolean;
  description: string;
}[] = [
  { id: 'all', label: 'All books', status: 'all', description: 'Every project that is not archived or in the trash.' },
  { id: 'drafts', label: 'Drafts', status: 'draft', description: 'Work in progress.' },
  { id: 'in_review', label: 'In review', status: 'in_review', description: 'Finished drafts going through your own review pass.' },
  { id: 'published', label: 'Published', status: 'published', description: 'Live on the marketplace or publicly readable.' },
  { id: 'ready', label: 'Ready', status: 'ready', description: 'Passed preflight, waiting to be published.' },
  { id: 'starred', label: 'Starred', status: 'all', starred: true, description: 'Your pinned favourites.' },
  { id: 'archived', label: 'Archived', status: 'archived', description: 'Hidden from the main list but kept forever.' },
  { id: 'trash', label: 'Trash', status: 'trashed', description: 'Deleted projects, restorable for 30 days.' },
];

export default function BooksListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, entitlements } = useAuth();
  const { success, error: errorToast, info } = useToast();
  const confirm = useConfirm();

  const view = params.get('view') ?? 'all';
  const [query, setQuery] = React.useState(params.get('q') ?? '');
  const [kind, setKind] = React.useState<string>('all');
  const [categoryId, setCategoryId] = React.useState('all');
  const [sort, setSort] = React.useState<'recent' | 'created' | 'title' | 'words' | 'pages'>('recent');
  const [layout, setLayout] = React.useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = React.useState<string[]>([]);
  const [page, setPage] = React.useState(1);
  const [renameTarget, setRenameTarget] = React.useState<Book | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const PER_PAGE = 12;

  const viewConfig = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];
  const { data: books, isLoading, isError, refetch } = useBooks({
    ownerId: user?.id,
    status: viewConfig.status,
    starredOnly: viewConfig.starred,
    query: query || undefined,
    kind: kind === 'all' ? 'all' : (kind as Book['kind']),
    categoryIds: categoryId === 'all' ? undefined : [categoryId],
    sort,
  });
  const { data: counts } = useBookCounts(user?.id);
  const { data: categories } = useCategories('book');

  const totalPages = Math.max(1, Math.ceil((books?.length ?? 0) / PER_PAGE));
  const visible = (books ?? []).slice((page - 1) * PER_PAGE, page * PER_PAGE);

  React.useEffect(() => setPage(1), [view, query, kind, categoryId, sort]);
  React.useEffect(() => setSelected([]), [view]);

  const setView = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('view', id);
    setParams(next);
  };

  const guard = (action: 'create' | 'export' | 'publish' | 'sell') => {
    if (action === 'create' && !entitlements.canCreateBook()) {
      errorToast('Book limit reached', entitlements.upgradeReason('book'));
      navigate('/dashboard/subscription');
      return false;
    }
    if (action === 'publish' && !entitlements.canPublish()) {
      errorToast('Publishing needs an upgrade', entitlements.upgradeReason('book'));
      navigate('/dashboard/subscription');
      return false;
    }
    if (action === 'sell' && !entitlements.canSellBook()) {
      errorToast('Marketplace selling is a paid feature', entitlements.upgradeReason('marketplace_selling'));
      navigate('/dashboard/subscription');
      return false;
    }
    return true;
  };

  const run = async (id: string, action: () => Promise<unknown> | unknown, message: string) => {
    setBusyId(id);
    try {
      await action();
      success(message);
    } catch (caught) {
      errorToast('That action failed', caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = (book: Book) => {
    if (!guard('create') || !user) return;
    void run(book.id, () => bookService.duplicate(book.id, user.id), `“${book.title}” duplicated.`);
  };

  const archive = async (book: Book) => {
    const ok = await confirm({
      title: `Archive “${book.title}”?`,
      description: 'Archived books stay in your workspace but leave the main list. You can unarchive at any time.',
      confirmLabel: 'Archive',
    });
    if (ok) void run(book.id, () => bookService.archive(book.id), 'Book archived.');
  };

  const moveToTrash = async (book: Book) => {
    const ok = await confirm({
      title: `Move “${book.title}” to the trash?`,
      description: 'You can restore it from the Trash view. Permanent deletion is a separate, confirmed action.',
      destructive: true,
      confirmLabel: 'Move to trash',
    });
    if (ok) void run(book.id, () => bookService.trash(book.id), 'Moved to the trash.');
  };

  const destroy = async (book: Book) => {
    const ok = await confirm({
      title: `Delete “${book.title}” permanently?`,
      description: 'This removes the book, its pages and its versions. It cannot be undone.',
      destructive: true,
      requireText: 'DELETE',
      confirmLabel: 'Delete forever',
    });
    if (ok) void run(book.id, () => bookService.remove(book.id), 'Book deleted permanently.');
  };

  const bulk = async (action: 'archive' | 'restore' | 'trash' | 'star') => {
    if (!selected.length) return;
    const ok = await confirm({
      title: `${action === 'trash' ? 'Move' : action === 'restore' ? 'Restore' : action === 'archive' ? 'Archive' : 'Star'} ${selected.length} books?`,
      description: 'This applies to every selected project.',
      destructive: action === 'trash',
      confirmLabel: 'Apply',
    });
    if (!ok) return;
    await Promise.all(
      selected.map((id) =>
        action === 'archive'
          ? bookService.archive(id)
          : action === 'restore'
            ? bookService.restore(id)
            : action === 'trash'
              ? bookService.trash(id)
              : bookService.toggleStar(id),
      ),
    );
    success(`${selected.length} books updated`);
    setSelected([]);
  };

  const exportBook = async (book: Book, format: 'pdf' | 'epub3' | 'docx') => {
    if (!entitlements.canExport(format)) {
      errorToast('Upgrade required', entitlements.upgradeReason(format));
      navigate('/dashboard/subscription');
      return;
    }
    setBusyId(book.id);
    try {
      const profileId = format === 'pdf' ? 'digital-pdf' : format === 'epub3' ? 'epub-reflowable' : 'digital-pdf';
      await exportService.run(book.id, format, profileId, {}, undefined, user?.id);
      exportService.download(book.id, format, { profileId });
      success('Export ready', `${format.toUpperCase()} download started.`);
    } catch (caught) {
      errorToast('Export failed', caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<Book>[] = [
    {
      key: 'book',
      header: 'Book',
      render: (book) => (
        <div className="flex items-center gap-3">
          <div className="w-10 shrink-0">
            <BookCover book={book} showSpine={false} />
          </div>
          <div className="min-w-0">
            <button type="button" onClick={() => navigate(`/dashboard/books/${book.id}`)} className="block truncate text-sm font-medium text-foreground hover:text-primary">
              {book.title}
            </button>
            <span className="block truncate text-2xs text-muted-foreground">
              {book.kind.replace('-', ' ')} · updated {timeAgo(book.updatedAt)}
            </span>
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (book) => <Badge variant={STATUS_TONE[book.status]}>{statusLabel(book.status)}</Badge> },
    { key: 'words', header: 'Words', align: 'right', render: (book) => <span className="tabular-nums">{formatNumber(book.wordCount)}</span> },
    { key: 'pages', header: 'Pages', align: 'right', render: (book) => <span className="tabular-nums">{book.pageCount}</span> },
    { key: 'chapters', header: 'Chapters', align: 'right', render: (book) => <span className="tabular-nums">{book.sections.length}</span> },
    { key: 'updated', header: 'Updated', render: (book) => <span className="text-xs text-muted-foreground">{formatDate(book.updatedAt)}</span> },
  ];

  if (isError) {
    return (
      <>
        <PageHeader title="My books" />
        <ErrorState title="Your books could not load" description="The local database did not respond." onRetry={() => refetch()} />
      </>
    );
  }

  return (
    <>
      <Seo title="My books" noIndex />
      <PageHeader
        title="My books"
        description={viewConfig.description}
        actions={
          <>
            <div className="flex rounded-lg border border-input" role="group" aria-label="Layout">
              {(['grid', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setLayout(mode)}
                  aria-pressed={layout === mode}
                  className={cn('px-3 py-2 text-xs font-medium capitalize', layout === mode ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => guard('create') && navigate('/dashboard/books/new')}>
              New book
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((entry) => {
          const count =
            entry.starred
              ? undefined
              : entry.status === 'all'
                ? counts?.all
                : entry.status === 'trashed'
                  ? counts?.trash
                  : entry.status === 'archived'
                    ? counts?.archived
                    : entry.status === 'published'
                      ? counts?.published
                      : entry.status === 'draft'
                        ? counts?.drafts
                        : undefined;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setView(entry.id)}
              aria-pressed={view === entry.id}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                view === entry.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40',
              )}
            >
              {entry.label}
              {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="books-search" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Search
          </label>
          <Input
            id="books-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('q', event.target.value);
              else next.delete('q');
              setParams(next, { replace: true });
            }}
            placeholder="Search titles, subtitles and tags…"
          />
        </div>
        <div className="w-[150px]">
          <label htmlFor="books-kind" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Type
          </label>
          <Select id="books-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="all">All types</option>
            {['fiction', 'nonfiction', 'children', 'workbook', 'journal', 'planner', 'cookbook', 'textbook', 'biography', 'poetry', 'guide'].map((entry) => (
              <option key={entry} value={entry}>
                {entry.replace('-', ' ')}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[170px]">
          <label htmlFor="books-category" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Category
          </label>
          <Select id="books-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">All categories</option>
            {(categories ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[160px]">
          <label htmlFor="books-sort" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Sort
          </label>
          <Select id="books-sort" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="recent">Recently updated</option>
            <option value="created">Newest created</option>
            <option value="title">Title A–Z</option>
            <option value="words">Most words</option>
            <option value="pages">Most pages</option>
          </Select>
        </div>
        {(query || kind !== 'all' || categoryId !== 'all') && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setKind('all');
              setCategoryId('all');
              setParams({ view });
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-2.5">
          <span className="text-sm text-foreground">{selected.length} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => bulk('star')}>
              Star
            </Button>
            {view === 'trash' ? (
              <Button size="sm" variant="outline" onClick={() => bulk('restore')}>
                Restore
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => bulk('archive')}>
                  Archive
                </Button>
                <Button size="sm" variant="outline" onClick={() => bulk('trash')}>
                  Move to trash
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-80 rounded-xl" />
          ))}
        </div>
      ) : !books?.length ? (
        <EmptyState
          icon="▤"
          title={query || kind !== 'all' || categoryId !== 'all' ? 'No books match those filters' : VIEW_EMPTY_TITLE[view] ?? 'Nothing here yet'}
          description={
            query || kind !== 'all' || categoryId !== 'all'
              ? 'Try a shorter search term, or clear the filters to see everything.'
              : VIEW_EMPTY_BODY[view] ?? 'Create a project to get started — blank, from a template, with AI, or by importing a manuscript.'
          }
          actions={
            query || kind !== 'all' || categoryId !== 'all' ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery('');
                  setKind('all');
                  setCategoryId('all');
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => guard('create') && navigate('/dashboard/books/new')}>Create a book</Button>
            )
          }
        />
      ) : layout === 'list' ? (
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(book) => book.id}
          loading={isLoading}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          onRowClick={(book) => navigate(`/dashboard/books/${book.id}`)}
          actions={(book) => (
            <BookRowActions
              book={book}
              busy={busyId === book.id}
              inTrash={book.status === 'trashed' || book.status === 'archived'}
              onOpen={() => navigate(`/dashboard/books/${book.id}`)}
              onEdit={() => navigate(`/dashboard/books/${book.id}/editor`)}
              onRename={() => {
                setRenameTarget(book);
                setRenameValue(book.title);
              }}
              onDuplicate={() => duplicate(book)}
              onArchive={() => (book.status === 'archived' ? run(book.id, () => bookService.unarchive(book.id), 'Book restored from archive.') : archive(book))}
              onTrash={() => (book.status === 'trashed' ? run(book.id, () => bookService.restore(book.id), 'Book restored.') : moveToTrash(book))}
              onDelete={() => destroy(book)}
              onExport={(format: 'pdf' | 'epub3' | 'docx') => exportBook(book, format)}
              onPublish={() => guard('publish') && navigate(`/dashboard/publishing?book=${book.id}`)}
            />
          )}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((book) => (
            <Card key={book.id} className="flex flex-col p-3.5">
              <div className="flex gap-3">
                <button type="button" onClick={() => navigate(`/dashboard/books/${book.id}`)} className="w-[78px] shrink-0" aria-label={`Open ${book.title}`}>
                  <BookCover book={book} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/books/${book.id}`)}
                      className="min-w-0 text-left text-sm font-semibold leading-snug text-foreground hover:text-primary"
                    >
                      <span className="line-clamp-2">{book.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={book.starred ? 'Unstar book' : 'Star book'}
                      onClick={() => run(book.id, () => bookService.toggleStar(book.id), book.starred ? 'Removed from starred' : 'Added to starred')}
                      className={cn('shrink-0 text-sm', book.starred ? 'text-warning' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {book.starred ? '★' : '☆'}
                    </button>
                  </div>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {book.kind.replace('-', ' ')} · {book.language}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant={STATUS_TONE[book.status]}>{statusLabel(book.status)}</Badge>
                    {book.visibility !== 'private' && <Badge variant="outline">{book.visibility}</Badge>}
                  </div>
                  {book.marketplace.reviewCount > 0 && (
                    <div className="mt-2">
                      <Rating value={book.marketplace.rating} count={book.marketplace.reviewCount} size={11} />
                    </div>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-border py-2.5 text-2xs">
                <div>
                  <dt className="text-muted-foreground">Words</dt>
                  <dd className="font-medium tabular-nums text-foreground">{formatNumber(book.wordCount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pages</dt>
                  <dd className="font-medium tabular-nums text-foreground">{book.pageCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="font-medium text-foreground">{timeAgo(book.updatedAt)}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Button size="xs" onClick={() => navigate(`/dashboard/books/${book.id}/editor`)} loading={busyId === book.id}>
                  {book.status === 'draft' ? 'Continue writing' : 'Open editor'}
                </Button>
                <Button size="xs" variant="outline" onClick={() => navigate(`/dashboard/books/${book.id}`)}>
                  Details
                </Button>
                <div className="ml-auto">
                  <BookRowActions
                    book={book}
                    busy={busyId === book.id}
                    inTrash={book.status === 'trashed' || book.status === 'archived'}
                    onOpen={() => navigate(`/dashboard/books/${book.id}`)}
                    onEdit={() => navigate(`/dashboard/books/${book.id}/editor`)}
                    onRename={() => {
                      setRenameTarget(book);
                      setRenameValue(book.title);
                    }}
                    onDuplicate={() => duplicate(book)}
                    onArchive={() => (book.status === 'archived' ? run(book.id, () => bookService.unarchive(book.id), 'Book restored from archive.') : archive(book))}
                    onTrash={() => (book.status === 'trashed' ? run(book.id, () => bookService.restore(book.id), 'Book restored.') : moveToTrash(book))}
                    onDelete={() => destroy(book)}
                    onExport={(format: 'pdf' | 'epub3' | 'docx') => exportBook(book, format)}
                    onPublish={() => guard('publish') && navigate(`/dashboard/publishing?book=${book.id}`)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6">
          <Pagination page={page} pageCount={totalPages} total={books?.length} pageSize={PER_PAGE} onPageChange={setPage} />
        </div>
      )}

      <Modal
        open={Boolean(renameTarget)}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        title="Rename book"
        description={renameTarget ? `Currently “${renameTarget.title}”.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!renameValue.trim()}
              onClick={() => {
                if (!renameTarget) return;
                void run(renameTarget.id, () => bookService.rename(renameTarget.id, renameValue.trim()), 'Book renamed.');
                setRenameTarget(null);
              }}
            >
              Save name
            </Button>
          </>
        }
      >
        <label htmlFor="rename-input" className="text-xs font-medium text-muted-foreground">
          New title
        </label>
        <Input
          id="rename-input"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          maxLength={120}
          className="mt-1.5"
          data-autofocus
        />
        <p className="mt-2 text-2xs text-muted-foreground">Renaming does not affect published listings already live on the marketplace until you re-publish.</p>
      </Modal>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total words</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">{formatNumber(counts?.totalWords ?? 0)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total pages</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">{formatNumber(counts?.totalPages ?? 0)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Templates available</p>
          <p className="mt-1 font-display text-2xl font-bold text-foreground">{templateService.list({ published: true }).length}</p>
          <Button size="xs" variant="ghost" className="mt-2 px-0" onClick={() => navigate('/dashboard/templates')}>
            Browse templates →
          </Button>
        </Card>
      </div>

      <p className="mt-4 text-2xs text-muted-foreground">
        Tip: press <kbd className="rounded border border-border px-1">N</kbd> on this page to start a new book, or use the command palette (
        <kbd className="rounded border border-border px-1">⌘K</kbd>) to jump to any project.
      </p>
      {selected.length === 0 && visible.length > 0 && (
        <span className="sr-only" aria-live="polite">
          {visible.length} books shown, {books?.length} in this view.
        </span>
      )}
      {busyId && <span className="sr-only" aria-live="polite">Working…</span>}
      {!entitlements.canPublish() && view === 'published' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Publishing requires a paid plan. Books stay in your workspace if you downgrade — nothing is deleted.
        </p>
      )}
      <button type="button" className="sr-only" onClick={() => info('Keyboard shortcuts', 'Press ? anywhere for the full shortcut list.')}>
        Keyboard shortcuts
      </button>
    </>
  );
}

const STATUS_TONE: Record<Book['status'], 'default' | 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'accent' | 'outline'> = {
  draft: 'warning',
  in_review: 'secondary',
  ready: 'info',
  published: 'success',
  archived: 'outline',
  trashed: 'danger',
};

const VIEW_EMPTY_TITLE: Record<string, string> = {
  all: 'No books yet',
  drafts: 'No drafts right now',
  published: 'Nothing published yet',
  private: 'No private books',
  ready: 'Nothing is ready to publish',
  starred: 'No starred books',
  archived: 'The archive is empty',
  trash: 'The trash is empty',
};

const VIEW_EMPTY_BODY: Record<string, string> = {
  drafts: 'Everything you have written is published, archived or in the trash. Start something new?',
  published: 'Finish a book and run preflight, then publish it to the marketplace or share it publicly.',
  private: 'Private books are finished projects you are not sharing yet. Move a book here from its details page.',
  ready: 'Books appear here once they pass preflight with no blocking errors.',
  starred: 'Star a book from the grid or list to pin it here for quick access.',
  archived: 'Books you archive land here, with everything intact.',
  trash: 'Deleted books stay recoverable for 30 days before permanent removal.',
};

function BookRowActions({
  book,
  busy,
  inTrash,
  onOpen,
  onEdit,
  onRename,
  onDuplicate,
  onArchive,
  onTrash,
  onDelete,
  onExport,
  onPublish,
}: {
  book: Book;
  busy: boolean;
  inTrash: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onDelete: () => void;
  onExport: (format: 'pdf' | 'epub3' | 'docx') => void;
  onPublish: () => void;
}) {
  return (
    <DropdownMenuActions
      busy={busy}
      items={[
        { id: 'open', label: inTrash ? 'Open details' : 'Open', onSelect: onOpen },
        ...(inTrash ? [] : [{ id: 'edit', label: 'Edit in editor', onSelect: onEdit }]),
        { id: 'preview', label: 'Preview reader', onSelect: onOpen },
        { id: 'd1', label: '', divider: true },
        { id: 'rename', label: 'Rename', onSelect: onRename },
        { id: 'duplicate', label: 'Duplicate', onSelect: onDuplicate, shortcut: '⌘D' },
        { id: 'd2', label: '', divider: true },
        { id: 'pdf', label: 'Export PDF', onSelect: () => onExport('pdf') },
        { id: 'epub', label: 'Export EPUB 3', onSelect: () => onExport('epub3') },
        { id: 'docx', label: 'Export DOCX', onSelect: () => onExport('docx') },
        { id: 'publish', label: book.status === 'published' ? 'Publishing centre' : 'Publish', onSelect: onPublish },
        { id: 'd3', label: '', divider: true },
        { id: 'archive', label: book.status === 'archived' ? 'Unarchive' : 'Archive', onSelect: onArchive },
        { id: 'trash', label: book.status === 'trashed' ? 'Restore from trash' : 'Move to trash', onSelect: onTrash, destructive: book.status !== 'trashed' },
        ...(book.status === 'trashed' ? [{ id: 'delete', label: 'Delete permanently', onSelect: onDelete, destructive: true }] : []),
      ]}
    />
  );
}

function DropdownMenuActions({ items, busy }: { items: MenuItemDef[]; busy: boolean }) {
  return (
    <DropdownMenu
      trigger={
        <Tooltip content="More actions">
          <button
            type="button"
            aria-label={`More actions for this book${busy ? ' (working)' : ''}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:text-foreground"
          >
            ⋯
          </button>
        </Tooltip>
      }
      items={items}
      align="end"
    />
  );
}
