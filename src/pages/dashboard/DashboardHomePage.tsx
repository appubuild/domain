import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import {
  useBooks,
  useBookCounts,
  useRevenueSummary,
  useRevenueSeries,
  useRevenueByBook,
  useOrders,
  useNotifications,
  useActivity,
  useAiUsage,
} from '@/hooks/queries';
import { useToast } from '@/components/ui/toast';
import { Seo } from '@/components/shared/Seo';
import { PageHeader } from '@/components/layout/AdminLayout';
import { BookCover } from '@/components/shared/BookCard';
import { Badge, Button, Card, CardContent, Progress, Skeleton, Tooltip } from '@/components/ui/primitives';
import { EmptyState, StatCard, UsageMeter } from '@/components/ui/data';
import { RevenueAreaChart, DonutChart } from '@/components/ui/charts';
import { DropdownMenu } from '@/components/ui/overlays';
import { formatCompactCurrency, formatCurrency, formatNumber, statusLabel, timeAgo } from '@/lib/format';
import { formatBytes, percent } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function DashboardHomePage() {
  const navigate = useNavigate();
  const { user, entitlements } = useAuth();
  const { success, info } = useToast();
  const [period, setPeriod] = React.useState<'7d' | '30d' | '90d' | '1y' | 'all'>('30d');

  const { data: counts, isLoading: countsLoading } = useBookCounts(user?.id);
  const { data: recentBooks, isLoading: booksLoading } = useBooks({ ownerId: user?.id, status: 'all', sort: 'recent' });
  const { data: revenue, isLoading: revenueLoading } = useRevenueSummary(user?.id, period);
  const { data: series } = useRevenueSeries(user?.id, period, 'revenue');
  const { data: orders } = useOrders(user?.id);
  const { data: notifications } = useNotifications(user?.id);
  const { data: activity } = useActivity(user?.id);
  const { data: aiUsage } = useAiUsage(user?.id);
  const { data: byBook } = useRevenueByBook(user?.id, period);
  const topBook = byBook?.[0];

  const recentOrders = (orders ?? []).slice(0, 5);
  const shelf = (recentBooks ?? []).slice(0, 6);
  const unread = (notifications ?? []).filter((entry) => !entry.read);
  const draft = (recentBooks ?? []).find((book) => book.status === 'draft') ?? recentBooks?.[0];

  const quickActions = [
    { id: 'new', label: 'New book', description: 'Blank, template, AI or import', icon: '＋', run: () => navigate('/dashboard/books/new') },
    { id: 'ai', label: 'Ask AI to draft', description: 'Open AI Studio with your project', icon: '✦', run: () => navigate('/dashboard/ai') },
    { id: 'export', label: 'Export a book', description: 'PDF, EPUB 3, DOCX and more', icon: '⇩', run: () => navigate('/dashboard/exports') },
    { id: 'publish', label: 'Publish', description: 'Ten-step submission flow', icon: '▲', run: () => navigate('/dashboard/publishing') },
    { id: 'asset', label: 'Upload assets', description: 'Images, fonts and illustrations', icon: '▣', run: () => navigate('/dashboard/assets') },
  ];

  const aiPercent = entitlements.usage.aiCredits.percent;
  const storagePercent = entitlements.usage.storage.percent;

  return (
    <>
      <Seo title="Dashboard" noIndex />
      <PageHeader
        title={`Good to see you, ${user?.name.split(' ')[0] ?? 'writer'}`}
        description="Everything you have written, published and earned — in one place."
        actions={
          <>
            <DropdownMenu
              trigger={
                <Button variant="outline" size="sm">
                  {period === '7d' ? 'Last 7 days' : period === '30d' ? 'Last 30 days' : period === '90d' ? 'Last 90 days' : period === '1y' ? 'Last 12 months' : 'All time'} ▾
                </Button>
              }
              items={[
                { id: '7d', label: 'Last 7 days', onSelect: () => setPeriod('7d'), checked: period === '7d' },
                { id: '30d', label: 'Last 30 days', onSelect: () => setPeriod('30d'), checked: period === '30d' },
                { id: '90d', label: 'Last 90 days', onSelect: () => setPeriod('90d'), checked: period === '90d' },
                { id: '1y', label: 'Last 12 months', onSelect: () => setPeriod('1y'), checked: period === '1y' },
                { id: 'all', label: 'All time', onSelect: () => setPeriod('all'), checked: period === 'all' },
              ]}
            />
            <Button size="sm" onClick={() => navigate('/dashboard/books/new')}>
              New book
            </Button>
          </>
        }
      />

      {unread.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-info/40 bg-info/10 px-4 py-3">
          <p className="text-sm text-foreground">
            <strong>{unread.length}</strong> new {unread.length === 1 ? 'notification' : 'notifications'} — {unread[0].title}
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/dashboard/notifications')}>
            Open notification centre
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {countsLoading || !counts ? (
          Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard label="Books" value={formatNumber(counts.all)} hint={`${counts.drafts} drafts · ${counts.published} published`} icon="▤" onClick={() => navigate('/dashboard/books')} />
            <StatCard label="Words written" value={formatNumber(counts.totalWords)} hint={`${formatNumber(counts.totalPages)} pages across all projects`} icon="✎" />
            <StatCard
              label="Revenue"
              value={revenueLoading ? '…' : formatCompactCurrency(revenue?.netEarnings ?? 0)}
              hint={
                revenue
                  ? `${formatNumber(revenue.totalSales)} sales · ${percent(revenue.refunds, Math.max(1, revenue.totalSales))}% refunded`
                  : undefined
              }
              icon="◉"
              onClick={() => navigate('/dashboard/earnings')}
            />
            <StatCard
              label="Licences sold"
              value={formatNumber(revenue?.totalSales ?? 0)}
              hint={topBook ? `Top title: ${topBook.title}` : 'No sales in this period yet'}
              icon="◈"
              onClick={() => navigate('/dashboard/analytics')}
            />
          </>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Revenue over time</h2>
                <p className="text-xs text-muted-foreground">Net of platform fees and refunds.</p>
              </div>
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={() => navigate('/dashboard/earnings')}>
                  Earnings detail
                </Button>
                <Button size="xs" variant="ghost" onClick={() => navigate('/dashboard/analytics')}>
                  Analytics
                </Button>
              </div>
            </div>
            {series && series.length > 0 ? (
              <RevenueAreaChart data={series.map((point) => ({ label: point.label ?? point.date, value: point.value }))} height={240} />
            ) : (
              <EmptyState
                icon="◉"
                title="No revenue in this period"
                description="Publish a book to the marketplace, or widen the date range to see earlier sales."
                actions={
                  <Button size="sm" onClick={() => navigate('/dashboard/publishing')}>
                    Publish a book
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold text-foreground">Plan usage</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entitlements.plan.name} plan · renews automatically
            </p>
            <div className="mt-4 space-y-4">
              <UsageMeter label="AI credits" used={entitlements.usage.aiCredits.used} limit={entitlements.usage.aiCredits.limit} />
              <UsageMeter label="AI images" used={entitlements.usage.aiImages.used} limit={entitlements.usage.aiImages.limit} />
              <UsageMeter label="Book projects" used={entitlements.usage.books.used} limit={entitlements.usage.books.limit} />
              <div>
                <p className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Storage</span>
                  <span className="tabular-nums text-foreground">
                    {formatBytes(entitlements.usage.storage.usedBytes, 1)} / {formatBytes(entitlements.usage.storage.limitBytes, 0)}
                  </span>
                </p>
                <Progress value={storagePercent} className="mt-1.5 h-1.5" />
              </div>
            </div>
            {aiUsage && aiUsage.length > 0 && (
              <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-2xs text-muted-foreground">
                {formatNumber(aiUsage.reduce((total, entry) => total + entry.credits, 0))} credits used across {aiUsage.length} generations recorded.
              </p>
            )}
            <Button
              size="sm"
              variant={entitlements.plan.slug === 'free' ? 'default' : 'outline'}
              className="mt-4 w-full"
              onClick={() => navigate('/dashboard/subscription')}
            >
              {entitlements.plan.slug === 'free' ? 'Upgrade for print & selling' : 'Manage subscription'}
            </Button>
            {(aiPercent > 80 || storagePercent > 80) && (
              <p className="mt-2 text-2xs text-warning-foreground dark:text-warning">
                You are approaching a limit. Upgrade to avoid interruptions.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Quick actions</h2>
              <span className="text-2xs text-muted-foreground">Five things authors do most</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.run}
                  className="rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-sm text-primary" aria-hidden>
                    {action.icon}
                  </span>
                  <span className="mt-2 block text-sm font-semibold text-foreground">{action.label}</span>
                  <span className="mt-0.5 block text-2xs text-muted-foreground">{action.description}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (draft) navigate(`/dashboard/books/${draft.id}/editor`);
                  else info('No drafts yet', 'Create a book to start writing.');
                }}
                className="rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-3 text-left transition-colors hover:bg-primary/10"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground" aria-hidden>
                  ▶
                </span>
                <span className="mt-2 block text-sm font-semibold text-foreground">{draft ? 'Continue writing' : 'Start writing'}</span>
                <span className="mt-0.5 block text-2xs text-muted-foreground">{draft ? draft.title : 'Open a project to begin'}</span>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
            <ul className="mt-3 space-y-3">
              {(activity ?? []).slice(0, 6).map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="min-w-0">
                    <button
                      type="button"
                      onClick={() => item.link && navigate(item.link)}
                      className={cn('block truncate text-xs text-foreground', item.link && 'hover:text-primary')}
                    >
                      {item.message}
                    </button>
                    <span className="block text-2xs text-muted-foreground">
                      {timeAgo(item.createdAt)}
                      {item.meta ? ` · ${item.meta}` : ''}
                    </span>
                  </span>
                </li>
              ))}
              {!activity?.length && <li className="text-xs text-muted-foreground">No activity recorded yet.</li>}
            </ul>
            <Button size="sm" variant="ghost" className="mt-3 w-full" onClick={() => navigate('/dashboard/activity')}>
              View all activity
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Recent books</h2>
              <Button size="xs" variant="ghost" onClick={() => navigate('/dashboard/books')}>
                All books →
              </Button>
            </div>
            {booksLoading ? (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-40 rounded-lg" />
                ))}
              </div>
            ) : !recentBooks?.length ? (
              <EmptyState
                icon="▤"
                title="No books yet"
                description="Create your first project — blank, from a template, with AI, or by importing a manuscript."
                actions={<Button size="sm" onClick={() => navigate('/dashboard/books/new')}>Create a book</Button>}
              />
            ) : (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
                {shelf.map((book) => (
                  <Tooltip key={book.id} content={`${book.title} · ${statusLabel(book.status)}`}>
                    <button type="button" onClick={() => navigate(`/dashboard/books/${book.id}`)} className="text-left">
                      <BookCover book={book} />
                      <span className="mt-2 block truncate text-2xs font-medium text-foreground">{book.title}</span>
                      <span className="block text-[10px] text-muted-foreground">{formatNumber(book.wordCount)} words</span>
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold text-foreground">Latest sales</h2>
            {!recentOrders.length ? (
              <p className="mt-3 text-xs text-muted-foreground">No purchases yet. Sales appear here in real time.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {recentOrders.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-foreground">{order.bookTitle}</span>
                      <span className="block text-2xs text-muted-foreground">
                        {order.number} · {timeAgo(order.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-foreground">{formatCurrency(order.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate('/dashboard/earnings')}>
                Earnings
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/dashboard/marketplace')}>
                Listings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardContent>
            <h2 className="text-sm font-semibold text-foreground">Book status mix</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Where your projects currently sit.</p>
            <div className="mt-4">
              <DonutChart
                data={[
                  { name: 'Drafts', value: counts?.drafts ?? 0 },
                  { name: 'Published', value: counts?.published ?? 0 },
                  { name: 'Private', value: counts?.private ?? 0 },
                  { name: 'Archived', value: counts?.archived ?? 0 },
                  { name: 'Trash', value: counts?.trash ?? 0 },
                ].filter((entry) => entry.value > 0)}
                height={200}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Finish your setup</h2>
              <Badge variant={user?.onboarded ? 'success' : 'warning'}>{user?.onboarded ? 'Complete' : 'Incomplete'}</Badge>
            </div>
            <ul className="mt-3 space-y-2.5">
              {[
                { label: 'Complete the onboarding survey', done: Boolean(user?.onboarded), to: '/onboarding' },
                { label: 'Add a public author profile', done: Boolean(user?.tagline), to: '/dashboard/profile' },
                { label: 'Verify your email for payouts', done: Boolean(user?.emailVerified), to: '/dashboard/settings?section=account' },
                { label: 'Add a payout method', done: Boolean(user?.payoutMethod), to: '/dashboard/earnings' },
                { label: 'Publish your first book', done: (counts?.published ?? 0) > 0, to: '/dashboard/publishing' },
              ].map((entry) => (
                <li key={entry.label} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span className={cn('text-xs', entry.done ? 'text-success' : 'text-muted-foreground')} aria-hidden>
                      {entry.done ? '✓' : '○'}
                    </span>
                    <span className={cn('text-sm', entry.done ? 'text-muted-foreground line-through' : 'text-foreground')}>{entry.label}</span>
                  </span>
                  {!entry.done && (
                    <Button size="xs" variant="outline" onClick={() => navigate(entry.to)}>
                      Do it
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => {
                success('Workspace reset queued', 'Use Settings → Data to reset the demo database.');
                navigate('/dashboard/settings');
              }}
            >
              Reset the demo data
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
