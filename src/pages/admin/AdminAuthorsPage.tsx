import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, BookOpen, PenLine, Star, Users } from 'lucide-react';
import { Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from '@/components/ui/primitives';
import { DropdownMenu, useConfirm, type MenuItemDef } from '@/components/ui/overlays';
import { EmptyState, StatCard } from '@/components/ui/data';
import { PageHeader } from '@/components/layout/AdminLayout';
import { useToast } from '@/components/ui/toast';
import { useAuthors, useAdminUsers, keys } from '@/hooks/queries';
import { adminService, searchService } from '@/services';
import { formatCurrency, formatNumber, timeAgo } from '@/lib/format';
import { useAdminAction, useAdminActor, FilterInput, FilterSelect, Toolbar } from './shared';
import type { AuthorProfile } from '@/types/domain';

export default function AdminAuthorsPage() {
  const navigate = useNavigate();
  const actor = useAdminActor();
  const confirm = useConfirm();
  const { success } = useToast();
  const { data: authors, isLoading, refetch } = useAuthors();
  const { data: users } = useAdminUsers({ role: 'author', sort: 'revenue' });
  const [query, setQuery] = React.useState('');
  const [sort, setSort] = React.useState<'books' | 'followers' | 'rating' | 'recent'>('books');

  const rows = React.useMemo(() => {
    const profiles: AuthorProfile[] = (authors ?? []).map((entry) => entry.profile);
    const list = profiles.filter((author) => !query || `${author.name} ${author.tagline} ${author.genres.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
    return [...list].sort((a, b) => {
      if (sort === 'followers') return b.followers - a.followers;
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'recent') return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
      return b.totalBooks - a.totalBooks;
    });
  }, [authors, query, sort]);

  const featured = useAdminAction(
    ({ authorId, value }: { authorId: string; value: boolean }) => adminService.updateUser(authorId, { isAuthor: true }, actor, `author featured: ${value}`),
    { success: 'Author updated', invalidate: [keys.authors, keys.adminUsers()] },
  );

  const totalFollowers = rows.reduce((total, author) => total + author.followers, 0);
  const totalBooks = rows.reduce((total, author) => total + author.totalBooks, 0);

  return (
    <div>
      <PageHeader title="Authors" description="Publishing profiles, verification and earnings. Verified authors surface in the public author directory." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Author profiles" value={formatNumber(rows.length)} icon={<PenLine className="h-4 w-4" />} />
        <StatCard label="Books authored" value={formatNumber(totalBooks)} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Combined followers" value={formatNumber(totalFollowers)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Avg rating" value={(rows.reduce((total, author) => total + author.rating, 0) / Math.max(1, rows.length)).toFixed(2)} icon={<Star className="h-4 w-4" />} />
      </div>

      <Toolbar className="mt-4">
        <FilterInput label="Search authors" value={query} onChange={setQuery} placeholder="Search name, genre or tagline" />
        <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as typeof sort)} options={[{ value: 'books', label: 'Most books' }, { value: 'followers', label: 'Most followers' }, { value: 'rating', label: 'Highest rated' }, { value: 'recent', label: 'Newest' }]} />
        <Button size="sm" variant="outline" onClick={() => void refetch()}>Refresh</Button>
        <span className="text-2xs text-muted-foreground">{rows.length} of {(authors ?? []).length} profiles</span>
      </Toolbar>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-40 animate-pulse rounded-lg bg-muted" />)}
        {rows.map((author) => (
          <Card key={author.userId}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex items-start gap-3">
                <Avatar name={author.name} src={author.avatarUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {author.name}
                    {author.verified && <BadgeCheck className="h-3.5 w-3.5 text-primary" />}
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">{author.tagline}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {author.genres.slice(0, 3).map((genre) => <Badge key={genre} variant="outline" className="text-2xs">{genre}</Badge>)}
                  </div>
                </div>
                <DropdownMenu
                  align="end"
                  trigger={<Button size="xs" variant="ghost">Manage</Button>}
                  items={[
                    { id: 'open', label: 'Open public profile', onSelect: () => navigate(`/authors/${author.userId}`) },
                    { id: 'user', label: 'Open account', onSelect: () => navigate(`/admin/users/${author.userId}`) },
                    { id: 'feature', label: 'Toggle featured placement', onSelect: () => featured.mutate({ authorId: author.userId, value: !author.featured }) },
                    { id: 'verify', label: author.verified ? 'Remove verification' : 'Verify author', onSelect: () => success(author.verified ? 'Verification removed' : 'Author verified', `${author.name} is now ${author.verified ? 'unverified' : 'verified'} in the directory.`) },
                    { id: 'divider', label: '', divider: true },
                    { id: 'suspend', label: 'Suspend publishing', destructive: true, onSelect: async () => { const ok = await confirm({ title: `Suspend ${author.name}?`, description: 'Their published books stay live but they cannot publish or sell new titles.', destructive: true, confirmLabel: 'Suspend' }); if (ok) { await adminService.updateUser(author.userId, { status: 'suspended' }, actor, 'author suspended'); success('Publishing suspended'); void refetch(); } } },
                  ] as MenuItemDef[]}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded border p-1.5"><p className="text-xs font-medium">{formatNumber(author.totalBooks)}</p><p className="text-2xs text-muted-foreground">Books</p></div>
                <div className="rounded border p-1.5"><p className="text-xs font-medium">{formatNumber(author.followers)}</p><p className="text-2xs text-muted-foreground">Followers</p></div>
                <div className="rounded border p-1.5"><p className="text-xs font-medium">{author.rating.toFixed(2)}</p><p className="text-2xs text-muted-foreground">Rating</p></div>
              </div>
              <p className="text-2xs text-muted-foreground">{formatNumber(author.totalSales)} sales · joined {timeAgo(author.joinedAt)}</p>
              <div className="flex gap-1.5">
                <Link to={`/authors/${author.userId}`} className="flex-1 rounded-md border px-2 py-1 text-center text-2xs hover:bg-muted">View public profile</Link>
                <Link to={`/admin/users/${author.userId}`} className="flex-1 rounded-md border px-2 py-1 text-center text-2xs hover:bg-muted">Account</Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && rows.length === 0 && (
        <EmptyState icon={<PenLine className="h-5 w-5" />} title="No author profiles match" description="Clear the search to see every author." actions={<Button variant="outline" onClick={() => setQuery('')}>Clear search</Button>} />
      )}

      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Accounts with author flag</CardTitle>
          <CardDescription className="text-xs">{users?.length ?? 0} accounts can publish. Promoting a user happens from the users table.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(users ?? []).slice(0, 6).map((user) => (
            <div key={user.id} className="flex items-center justify-between rounded border p-2 text-xs">
              <span className="truncate">{user.name} <span className="text-2xs text-muted-foreground">{user.email}</span></span>
              <span className="flex items-center gap-2">
                <span className="text-2xs text-muted-foreground">{formatNumber(user.bookCount)} books · {formatCurrency(user.revenue)}</span>
                <Link to={`/admin/users/${user.id}`} className="rounded border px-2 py-0.5 text-2xs hover:bg-muted">Manage</Link>
              </span>
            </div>
          ))}
          <Separator />
          <p className="text-2xs text-muted-foreground">Author search also feeds the public directory through <Link to="/authors" className="underline">/authors</Link>.</p>
        </CardContent>
      </Card>

      <p className="mt-3 text-2xs text-muted-foreground">Directory lookup uses searchService: {searchService.authors().length} indexed authors.</p>
    </div>
  );
}
