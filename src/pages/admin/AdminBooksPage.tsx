import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Download, Eye, Flag, Star, Trash2, Undo2, Upload } from 'lucide-react';
import { Badge, Button, Card, CardContent } from '@/components/ui/primitives';
import { DropdownMenu, useConfirm, type MenuItemDef } from '@/components/ui/overlays';
import { DataTable, EmptyState, StatCard, type Column } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAdminBooks, useAdminOverview, useCategories, keys } from '@/hooks/queries';
import { adminService } from '@/services';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterInput, FilterSelect, StatusPill, Toolbar, BOOK_STATUS_FILTERS } from './shared';
import type { Book } from '@/types/domain';

export default function AdminBooksPage() {
  const navigate = useNavigate();
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success, info } = useToast();
  const { data: overview } = useAdminOverview();
  const { data: categories } = useCategories('book');
  const [query, setQuery] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [categoryId, setCategoryId] = React.useState('all');
  const [featured, setFeatured] = React.useState<'all' | 'featured' | 'not'>('all');
  const [sort, setSort] = React.useState<'recent' | 'sales' | 'views' | 'rating'>('recent');
  const [selected, setSelected] = React.useState<string[]>([]);

  const { data: books, isLoading, refetch } = useAdminBooks({ query: query || undefined, status, categoryId: categoryId === 'all' ? undefined : categoryId, sort });

  const moderate = useAdminAction(
    ({ bookId, action }: { bookId: string; action: Parameters<typeof adminService.moderateBook>[1] }) => adminService.moderateBook(bookId, action, actor),
    { success: 'Book updated', detail: 'Moderation recorded in the audit log.', invalidate: [keys.adminBooks(), keys.adminOverview, keys.books()] },
  );

  const rows = React.useMemo(() => {
    let list = (books ?? []) as Book[];
    if (featured === 'featured') list = list.filter((book) => book.marketplace.featured);
    if (featured === 'not') list = list.filter((book) => !book.marketplace.featured);
    return list;
  }, [books, featured]);

  const columns: Column<Book>[] = [
    {
      key: 'title',
      header: 'Book',
      render: (book) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-xs font-medium">
            {book.title}
            {book.marketplace.featured && <Star className="h-3 w-3 text-amber-500" />}
            {book.marketplace.staffPick && <Badge variant="info" className="text-2xs">staff pick</Badge>}
          </p>
          <p className="truncate text-2xs text-muted-foreground">{book.authorName} · {book.kind.replace('-', ' ')} · {formatNumber(book.wordCount)} words</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (book) => <StatusPill value={book.status} /> },
    { key: 'visibility', header: 'Visibility', render: (book) => <span className="text-2xs capitalize">{book.visibility.replace('-', ' ')}</span> },
    { key: 'price', header: 'Price', align: 'right', sortable: true, render: (book) => (book.marketplace.price > 0 ? formatCurrency(book.marketplace.price) : <Badge variant="success" className="text-2xs">free</Badge>) },
    { key: 'views', header: 'Views', align: 'right', sortable: true, render: (book) => formatNumber(book.marketplace.views) },
    { key: 'sales', header: 'Sales', align: 'right', sortable: true, render: (book) => formatNumber(book.marketplace.sales) },
    { key: 'rating', header: 'Rating', align: 'right', sortable: true, render: (book) => book.marketplace.rating.toFixed(2) },
    { key: 'updatedAt', header: 'Updated', align: 'right', render: (book) => <span className="text-2xs text-muted-foreground">{timeAgo(book.updatedAt)}</span> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (book) => (
        <DropdownMenu
          align="end"
          trigger={<Button size="xs" variant="ghost">Moderate</Button>}
          items={[
            { id: 'open', label: 'Open in dashboard', onSelect: () => navigate(`/dashboard/books/${book.id}`) },
            { id: 'editor', label: 'Open editor', onSelect: () => navigate(`/dashboard/books/${book.id}/editor`) },
            { id: 'read', label: 'Preview reader', onSelect: () => navigate(`/read/${book.id}`) },
            { id: 'divider', label: '', divider: true },
            { id: 'feature', label: book.marketplace.featured ? 'Remove from featured' : 'Feature on marketplace', onSelect: () => moderate.mutate({ bookId: book.id, action: book.marketplace.featured ? 'unfeature' : 'feature' }) },
            { id: 'staff', label: book.marketplace.staffPick ? 'Remove staff pick' : 'Mark as staff pick', onSelect: () => moderate.mutate({ bookId: book.id, action: 'staff-pick' }) },
            { id: 'trending', label: 'Flag as trending', onSelect: () => moderate.mutate({ bookId: book.id, action: 'trending' }) },
            { id: 'hide', label: book.status === 'archived' ? 'Restore to draft' : 'Hide from marketplace', onSelect: () => moderate.mutate({ bookId: book.id, action: book.status === 'archived' ? 'restore' : 'hide' }) },
            { id: 'unpublish', label: 'Unpublish', onSelect: async () => { const ok = await confirm({ title: `Unpublish “${book.title}”?`, description: 'Readers keep their copies; the listing is removed from the marketplace.', confirmLabel: 'Unpublish' }); if (ok) moderate.mutate({ bookId: book.id, action: 'unpublish' }); } },
            { id: 'divider2', label: '', divider: true },
            { id: 'delete', label: 'Move to trash', destructive: true, onSelect: async () => { const ok = await confirm({ title: `Trash “${book.title}”?`, description: 'The author can restore it from their trash view.', destructive: true, confirmLabel: 'Move to trash' }); if (ok) moderate.mutate({ bookId: book.id, action: 'delete' }); } },
          ] as MenuItemDef[]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Books" description="Catalogue moderation: feature titles, hide listings, resolve reports and keep the marketplace trustworthy.">
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const csv = ['title,author,status,visibility,price,views,sales,rating', ...rows.map((book) => [book.title, book.authorName, book.status, book.visibility, book.marketplace.price, book.marketplace.views, book.marketplace.sales, book.marketplace.rating].join(','))].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'scriptora-books.csv';
              link.click();
              URL.revokeObjectURL(url);
              success('Catalogue exported', `${rows.length} rows`);
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export catalogue
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}><Upload className="h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total books" value={formatNumber(overview?.books.total ?? 0)} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Published" value={formatNumber(overview?.books.published ?? 0)} change={`+${overview?.books.published7d ?? 0} / 7d`} />
        <StatCard label="Drafts" value={formatNumber(overview?.books.drafts ?? 0)} />
        <StatCard label="Trashed" value={formatNumber(overview?.books.trashed ?? 0)} icon={<Trash2 className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search books" value={query} onChange={setQuery} placeholder="Search title, author or tag" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={BOOK_STATUS_FILTERS} />
        <FilterSelect label="Category" value={categoryId} onChange={setCategoryId} options={[{ value: 'all', label: 'All categories' }, ...(categories ?? []).map((category) => ({ value: category.id, label: category.name }))]} />
        <FilterSelect label="Featured" value={featured} onChange={(value) => setFeatured(value as typeof featured)} options={[{ value: 'all', label: 'Featured & normal' }, { value: 'featured', label: 'Featured only' }, { value: 'not', label: 'Not featured' }]} />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'recent', label: 'Recently updated' }, { value: 'sales', label: 'Best selling' }, { value: 'views', label: 'Most viewed' }, { value: 'rating', label: 'Highest rated' }]} />
      </Toolbar>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <span className="text-xs font-medium">{selected.length} selected</span>
          <Button size="xs" variant="outline" onClick={async () => { for (const bookId of selected) await adminService.moderateBook(bookId, 'feature', actor); success(`${selected.length} books featured`); setSelected([]); void refetch(); }}><Star className="h-3 w-3" /> Feature</Button>
          <Button size="xs" variant="outline" onClick={async () => { for (const bookId of selected) await adminService.moderateBook(bookId, 'hide', actor); success(`${selected.length} listings hidden`); setSelected([]); void refetch(); }}><Eye className="h-3 w-3" /> Hide</Button>
          <Button size="xs" variant="outline" onClick={async () => { for (const bookId of selected) await adminService.moderateBook(bookId, 'restore', actor); success(`${selected.length} books restored`); setSelected([]); void refetch(); }}><Undo2 className="h-3 w-3" /> Restore</Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            emptyState={<EmptyState icon={<BookOpen className="h-5 w-5" />} title="No books match" description="Adjust the filters or clear the search." />}
          />
        </CardContent>
      </Card>

      <p className="mt-3 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1"><Flag className="h-3 w-3" /> Flagged titles appear in <Link to="/admin/reports" className="underline">Reports</Link>.</span>
        <span>Featured titles drive the marketplace carousel and homepage spotlight.</span>
        <Button size="xs" variant="ghost" onClick={() => info('Bulk import', 'DOCX/EPUB import runs inside the author app; admin bulk ingest is a Phase 4 item.')}>Bulk import</Button>
      </p>
    </div>
  );
}
