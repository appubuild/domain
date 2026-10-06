import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity as ActivityIcon, BarChart3, BookOpen, Brain, Clock, Download, FileText, Filter, MessageSquare, Rocket, Search, Shield, ShoppingCart, Star, UserCheck,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { EmptyState, Pagination, StatCard } from '@/components/ui/data';
import { useActivity, useBooks, useExports, useOrders } from '@/hooks/queries';
import { useAuth } from '@/providers/AuthProvider';
import { formatDate, formatDateTime, formatNumber, timeAgo } from '@/lib/format';
import { cn, percent } from '@/lib/utils';
import type { ActivityItem } from '@/types/domain';

const TYPE_META: Record<ActivityItem['type'], { label: string; icon: React.ReactNode; className: string }> = {
  book: { label: 'Books', icon: <BookOpen className="h-3.5 w-3.5" />, className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
  export: { label: 'Exports', icon: <Download className="h-3.5 w-3.5" />, className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  publish: { label: 'Publishing', icon: <Rocket className="h-3.5 w-3.5" />, className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  sale: { label: 'Sales', icon: <ShoppingCart className="h-3.5 w-3.5" />, className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  ai: { label: 'AI', icon: <Brain className="h-3.5 w-3.5" />, className: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400' },
  comment: { label: 'Comments', icon: <MessageSquare className="h-3.5 w-3.5" />, className: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  review: { label: 'Reviews', icon: <Star className="h-3.5 w-3.5" />, className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  auth: { label: 'Account', icon: <UserCheck className="h-3.5 w-3.5" />, className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  admin: { label: 'Admin', icon: <Shield className="h-3.5 w-3.5" />, className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
};

export default function ActivityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: activity, isLoading } = useActivity(user?.id);
  const { data: books } = useBooks({ ownerId: user?.id, status: 'all' });
  const { data: exports } = useExports(user?.id);
  const { data: orders } = useOrders(user?.id);
  const [query, setQuery] = React.useState('');
  const [type, setType] = React.useState<'all' | ActivityItem['type']>('all');
  const [range, setRange] = React.useState<'all' | 'today' | 'week' | 'month'>('all');
  const [page, setPage] = React.useState(1);
  const perPage = 20;

  const all = React.useMemo(() => (activity ?? []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [activity]);

  const within = React.useCallback((iso: string) => {
    const age = Date.now() - new Date(iso).getTime();
    if (range === 'today') return age <= 86_400_000;
    if (range === 'week') return age <= 7 * 86_400_000;
    if (range === 'month') return age <= 30 * 86_400_000;
    return true;
  }, [range]);

  const rows = React.useMemo(() => {
    return all.filter((item) => {
      if (!within(item.createdAt)) return false;
      if (type !== 'all' && item.type !== type) return false;
      if (query && !`${item.message} ${item.meta ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [all, within, type, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);

  const counts = React.useMemo(() => {
    const byType = Object.keys(TYPE_META).map((key) => ({ type: key as ActivityItem['type'], count: all.filter((item) => item.type === key).length }));
    return {
      byType: byType.filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count),
      today: all.filter((item) => within2(item.createdAt, 1)).length,
      week: all.filter((item) => within2(item.createdAt, 7)).length,
    };
  }, [all]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    visible.forEach((item) => {
      const key = formatDate(item.createdAt);
      map.set(key, [...(map.get(key) ?? []), item]);
    });
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">Everything that has happened in your workspace, newest first.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/notifications')}>
            <ActivityIcon className="h-4 w-4" /> Notification centre
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/analytics')}>
            <BarChart3 className="h-4 w-4" /> Analytics
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Events logged" value={formatNumber(all.length)} hint={`${counts.today} today · ${counts.week} this week`} icon={<ActivityIcon className="h-4 w-4" />} />
        <StatCard label="Books touched" value={formatNumber((books ?? []).length)} hint={`${(books ?? []).filter((book) => book.status === 'published').length} published`} icon={<BookOpen className="h-4 w-4" />} />
        <StatCard label="Exports built" value={formatNumber((exports ?? []).length)} hint="Stored in object storage" icon={<Download className="h-4 w-4" />} />
        <StatCard label="Orders" value={formatNumber((orders ?? []).length)} hint="Purchases and sales combined" icon={<ShoppingCart className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>{rows.length} events match</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search activity" className="h-9 w-[200px] pl-8" aria-label="Search activity" />
              </div>
              <select value={range} onChange={(event) => { setRange(event.target.value as typeof range); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by date range">
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={type}
              onValueChange={(value) => { setType(value as typeof type); setPage(1); }}
              tabs={[{ value: 'all', label: 'All', count: all.length }, ...counts.byType.map((entry) => ({ value: entry.type, label: TYPE_META[entry.type].label, count: entry.count }))]}
            />

            {isLoading && <div className="space-y-2">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>}

            {!isLoading && rows.length === 0 && (
              <EmptyState
                icon={<ActivityIcon className="h-5 w-5" />}
                title={all.length === 0 ? 'No activity yet' : 'Nothing matches'}
                description={all.length === 0 ? 'Create a book, run an AI action or publish — every meaningful event is recorded here.' : 'Try a different type, range or search term.'}
                actions={all.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setQuery(''); setType('all'); setRange('all'); }}>Clear filters</Button> : <Button size="sm" onClick={() => navigate('/dashboard/books/new')}>Create a book</Button>}
              />
            )}

            {!isLoading && grouped.map(([date, items]) => (
              <div key={date}>
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{date}</span>
                  <Separator className="flex-1" />
                  <span className="text-2xs text-muted-foreground">{items.length} events</span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => {
                    const meta = TYPE_META[item.type];
                    return (
                      <div key={item.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
                        <span className={cn('mt-0.5 rounded-full p-1.5', meta.className)}>{meta.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{item.message}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                            <span>{timeAgo(item.createdAt)}</span>
                            <span>{formatDateTime(item.createdAt)}</span>
                            {item.meta && <span className="font-mono">{item.meta}</span>}
                          </div>
                        </div>
                        {item.link && (
                          <Button variant="ghost" size="xs" onClick={() => navigate(item.link as string)}>Open</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By type</CardTitle>
              <CardDescription>Where your time goes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {counts.byType.map((entry) => (
                <button
                  key={entry.type}
                  type="button"
                  onClick={() => { setType(entry.type); setPage(1); }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40"
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('rounded-full p-1', TYPE_META[entry.type].className)}>{TYPE_META[entry.type].icon}</span>
                    {TYPE_META[entry.type].label}
                  </span>
                  <span className="text-xs text-muted-foreground">{entry.count} · {percent(entry.count, Math.max(1, all.length)).toFixed(0)}%</span>
                </button>
              ))}
              {counts.byType.length === 0 && <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Milestones</CardTitle>
              <CardDescription>Highlights from your history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { icon: <BookOpen className="h-3.5 w-3.5" />, label: 'First book created', item: all.slice().reverse().find((entry) => entry.type === 'book') },
                { icon: <Rocket className="h-3.5 w-3.5" />, label: 'First publish', item: all.slice().reverse().find((entry) => entry.type === 'publish') },
                { icon: <ShoppingCart className="h-3.5 w-3.5" />, label: 'First sale', item: all.slice().reverse().find((entry) => entry.type === 'sale') },
                { icon: <Brain className="h-3.5 w-3.5" />, label: 'First AI generation', item: all.slice().reverse().find((entry) => entry.type === 'ai') },
                { icon: <Download className="h-3.5 w-3.5" />, label: 'First export', item: all.slice().reverse().find((entry) => entry.type === 'export') },
              ].map((milestone) => (
                <div key={milestone.label} className="rounded-lg border px-3 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium">{milestone.icon} {milestone.label}</p>
                  {milestone.item ? (
                    <p className="mt-1 text-xs text-muted-foreground">{milestone.item.message} · {timeAgo(milestone.item.createdAt)}</p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Not yet — keep working.</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base"><Clock className="mr-1.5 inline h-3.5 w-3.5" /> Working pattern</CardTitle>
              <CardDescription>Events by hour of day (last 30 days)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-24 items-end gap-0.5">
                {Array.from({ length: 24 }).map((_, hour) => {
                  const count = all.filter((item) => new Date(item.createdAt).getHours() === hour && within2(item.createdAt, 30)).length;
                  const max = Math.max(1, ...Array.from({ length: 24 }).map((_, index) => all.filter((item) => new Date(item.createdAt).getHours() === index).length));
                  return (
                    <div key={hour} className="flex-1 rounded-sm bg-primary/70" style={{ height: `${Math.max(4, (count / max) * 100)}%` }} title={`${hour}:00 — ${count} events`} />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-2xs text-muted-foreground">
                <span>00:00</span><span>12:00</span><span>23:00</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reports</CardTitle>
              <CardDescription>Generated summaries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: 'Weekly writing report', detail: 'Words written, sessions and streaks' },
                { label: 'Monthly revenue report', detail: 'Sales, payouts and top titles' },
              ].map((report) => (
                <div key={report.label} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div>
                    <p className="text-sm">{report.label}</p>
                    <p className="text-xs text-muted-foreground">{report.detail}</p>
                  </div>
                  <Button variant="outline" size="xs" onClick={() => navigate('/dashboard/analytics')}>
                    <FileText className="h-3 w-3" /> View
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Filter className="h-3.5 w-3.5" /> Activity is generated by the services layer as you use the app, and persists for the session.
      </p>
    </div>
  );
}

function within2(iso: string, days: number) {
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000;
}
