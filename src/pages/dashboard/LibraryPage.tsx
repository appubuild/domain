import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Bookmark, Download, Filter, Grid3X3, Library as LibraryIcon, List, Play, RotateCcw, Search, Trash2, TrendingUp,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { EmptyState, Pagination, StatCard } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useLibrary } from '@/hooks/queries';
import { marketplaceService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatCompactCurrency, formatDate, formatNumber, timeAgo } from '@/lib/format';
import { cn, percent } from '@/lib/utils';
import type { Book, LibraryItem } from '@/types/domain';

type LibraryRow = { item: LibraryItem; book?: Book };

type StatusFilter = 'all' | 'reading' | 'unread' | 'finished' | 'downloaded';

export default function LibraryPage() {
  const { user } = useAuth();
  const { success } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: library, isLoading } = useLibrary(user?.id);
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [sort, setSort] = React.useState<'recent' | 'title' | 'progress' | 'acquired'>('recent');
  const [layout, setLayout] = React.useState<'grid' | 'list'>('grid');
  const [page, setPage] = React.useState(1);
  const perPage = 12;

  const rows = React.useMemo<LibraryRow[]>(() => {
    const list = (library ?? []).filter((entry) => {
      if (!entry.book) return false;
      if (query && !`${entry.book.title} ${entry.item.source}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (status === 'reading') return entry.item.progress > 0 && entry.item.progress < 100;
      if (status === 'unread') return entry.item.progress === 0;
      if (status === 'finished') return entry.item.progress >= 100;
      if (status === 'downloaded') return entry.item.downloaded;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === 'title') return (a.book?.title ?? '').localeCompare(b.book?.title ?? '');
      if (sort === 'progress') return b.item.progress - a.item.progress;
      if (sort === 'acquired') return a.item.acquiredAt < b.item.acquiredAt ? 1 : -1;
      return (a.item.lastReadAt ?? a.item.acquiredAt) < (b.item.lastReadAt ?? b.item.acquiredAt) ? 1 : -1;
    });
  }, [library, query, status, sort]);

  const stats = React.useMemo(() => {
    const items = (library ?? []).filter((entry) => entry.book);
    const finished = items.filter((entry) => entry.item.progress >= 100).length;
    const reading = items.filter((entry) => entry.item.progress > 0 && entry.item.progress < 100).length;
    const value = items.reduce((total, entry) => total + (entry.book?.marketplace.price ?? 0), 0);
    const pages = items.reduce((total, entry) => total + (entry.book?.pageCount ?? 0), 0);
    return { total: items.length, finished, reading, value, pages };
  }, [library]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);

  const remove = async (entry: LibraryRow) => {
    if (!user || !entry.book) return;
    const ok = await confirm({
      title: `Remove “${entry.book.title}” from your library?`,
      description: 'Your purchase receipt is kept, so you can re-add it later from the marketplace.',
      confirmLabel: 'Remove title',
      destructive: true,
    });
    if (!ok) return;
    marketplaceService.removeFromLibrary(user.id, entry.book.id);
    qc.invalidateQueries({ queryKey: ['library'] });
    success('Removed from library');
  };

  if (isLoading) {
    return <div className="space-y-4"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-muted" />)}</div></div>;
  }

  if (!library || library.length === 0) {
    return (
      <EmptyState
        icon={<LibraryIcon className="h-5 w-5" />}
        title="Your library is empty"
        description="Books you buy, download or receive as gifts appear here with your reading progress."
        actions={<Button onClick={() => navigate('/marketplace')}>Browse the marketplace</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">My library</h1>
          <p className="text-sm text-muted-foreground">Everything you own, with reading progress, bookmarks and downloads.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/marketplace')}>
            <Search className="h-4 w-4" /> Find more books
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Books owned" value={formatNumber(stats.total)} hint={`${formatNumber(stats.pages)} pages total`} icon={<LibraryIcon className="h-4 w-4" />} />
        <StatCard label="Currently reading" value={formatNumber(stats.reading)} hint="Pick up where you left off" icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Finished" value={formatNumber(stats.finished)} hint={`${percent(stats.finished, stats.total).toFixed(0)}% of your library`} icon={<TrendingUp className="h-4 w-4" />} tone="success" />
        <StatCard label="Library value" value={formatCompactCurrency(stats.value)} hint="Total list price owned" icon={<Download className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Shelves</CardTitle>
            <CardDescription>{rows.length} of {stats.total} titles</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search your library" className="h-9 w-[210px] pl-8" aria-label="Search library" />
            </div>
            <select value={status} onChange={(event) => { setStatus(event.target.value as StatusFilter); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by reading status">
              <option value="all">All books</option>
              <option value="reading">Reading</option>
              <option value="unread">Unread</option>
              <option value="finished">Finished</option>
              <option value="downloaded">Downloaded</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Sort library">
              <option value="recent">Recently read</option>
              <option value="acquired">Recently added</option>
              <option value="title">Title A–Z</option>
              <option value="progress">Most progress</option>
            </select>
            <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
              <Button variant={layout === 'grid' ? 'secondary' : 'ghost'} size="xs" onClick={() => setLayout('grid')} aria-label="Grid view"><Grid3X3 className="h-3.5 w-3.5" /></Button>
              <Button variant={layout === 'list' ? 'secondary' : 'ghost'} size="xs" onClick={() => setLayout('list')} aria-label="List view"><List className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {visible.length === 0 && (
            <EmptyState
              icon={<Filter className="h-5 w-5" />}
              title="No titles match"
              description="Try a different filter or clear your search."
              actions={<Button variant="outline" size="sm" onClick={() => { setQuery(''); setStatus('all'); }}>Clear filters</Button>}
            />
          )}

          {layout === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map(({ item, book }) => {
                if (!book) return null;
                return (
                  <div key={item.id} className="group overflow-hidden rounded-xl border">
                    <div className="relative flex h-[200px] items-center justify-center bg-muted/40 p-4">
                      <div className="h-full w-[126px] overflow-hidden rounded shadow-page">
                        {book.cover.imageUrl
                          ? <img src={book.cover.imageUrl} alt={`Cover of ${book.title}`} className="h-full w-full object-cover" />
                          : <div className="flex h-full w-full items-center justify-center bg-brand-gradient p-2 text-center text-xs font-semibold text-white">{book.title}</div>}
                      </div>
                      <Badge variant={item.source === 'purchase' ? 'info' : item.source === 'free' ? 'success' : 'accent'} className="absolute left-3 top-3 text-2xs capitalize">{item.source}</Badge>
                    </div>
                    <div className="space-y-2 p-3">
                      <div>
                        <p className="truncate text-sm font-medium">{book.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{book.authorName}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                          <span>{item.progress}% read</span>
                          <span>{item.bookmarkedPages.length} bookmarks</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${item.progress}%` }} />
                        </div>
                      </div>
                      <p className="text-2xs text-muted-foreground">{item.lastReadAt ? `Continued ${timeAgo(item.lastReadAt)}` : `Added ${formatDate(item.acquiredAt)}`}</p>
                      <div className="flex items-center gap-1.5">
                        <Button size="xs" className="flex-1" onClick={() => navigate(`/read/${book.id}`)}>
                          <Play className="h-3 w-3" /> {item.progress > 0 && item.progress < 100 ? 'Continue' : item.progress >= 100 ? 'Read again' : 'Start reading'}
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => { marketplaceService.markDownloaded(user?.id as string, book.id); qc.invalidateQueries({ queryKey: ['library'] }); success('Marked as downloaded'); }} aria-label="Mark downloaded">
                          <Download className={cn('h-3 w-3', item.downloaded && 'text-emerald-500')} />
                        </Button>
                        <Button variant="outline" size="xs" onClick={() => remove({ item, book })} aria-label="Remove from library">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(({ item, book }) => {
                if (!book) return null;
                return (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-12 w-8 shrink-0 overflow-hidden rounded-sm bg-muted">
                        {book.cover.imageUrl ? <img src={book.cover.imageUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-brand-gradient" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{book.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {book.authorName} · {item.progress}% · {item.bookmarkedPages.length} bookmarks · {item.downloaded ? 'downloaded' : 'in cloud'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">{item.source}</Badge>
                      <Button variant="outline" size="xs" onClick={() => navigate(`/read/${book.id}`)}><BookOpen className="h-3 w-3" /> Read</Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => { marketplaceService.resetProgress(user?.id as string, book.id); qc.invalidateQueries({ queryKey: ['library'] }); success('Progress reset'); }}
                      >
                        <RotateCcw className="h-3 w-3" /> Reset
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => remove({ item, book })}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reading insights</CardTitle>
          <CardDescription>Your habits across everything in the library.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bookmark className="h-3.5 w-3.5" /> Bookmarks saved</p>
            <p className="mt-1 text-lg font-semibold">{formatNumber((library ?? []).reduce((total, entry) => total + entry.item.bookmarkedPages.length, 0))}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Average completion</p>
            <p className="mt-1 text-lg font-semibold">{percent((library ?? []).reduce((total, entry) => total + entry.item.progress, 0), Math.max(1, (library ?? []).length * 100)).toFixed(0)}%</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Download className="h-3.5 w-3.5" /> Downloaded offline</p>
            <p className="mt-1 text-lg font-semibold">{formatNumber((library ?? []).filter((entry) => entry.item.downloaded).length)}</p>
          </div>
        </CardContent>
      </Card>

      <Separator />
      <p className="text-center text-xs text-muted-foreground">Library entries are stored in the mock database and survive reloads in this browser.</p>
    </div>
  );
}
