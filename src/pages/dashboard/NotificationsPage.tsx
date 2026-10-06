import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell, BellRing, BookOpen, Brain, Check, CheckCheck, Filter, Mail, MessageSquare, PartyPopper, Search, Settings, ShoppingCart, Star, Trash2, Upload, Users,
} from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Separator } from '@/components/ui/primitives';
import { Tabs } from '@/components/ui/overlays';
import { EmptyState, Pagination } from '@/components/ui/data';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/overlays';
import { useEmails, useNotifications } from '@/hooks/queries';
import { notificationService } from '@/services';
import { useAuth } from '@/providers/AuthProvider';
import { formatDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AppNotification, NotificationType } from '@/types/domain';

const TYPE_META: Record<NotificationType, { label: string; icon: React.ReactNode; tone: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'secondary' }> = {
  export: { label: 'Export', icon: <Upload className="h-3.5 w-3.5" />, tone: 'info' },
  ai: { label: 'AI', icon: <Brain className="h-3.5 w-3.5" />, tone: 'accent' },
  sale: { label: 'Sale', icon: <ShoppingCart className="h-3.5 w-3.5" />, tone: 'success' },
  review: { label: 'Review', icon: <Star className="h-3.5 w-3.5" />, tone: 'warning' },
  comment: { label: 'Comment', icon: <MessageSquare className="h-3.5 w-3.5" />, tone: 'info' },
  subscription: { label: 'Subscription', icon: <Bell className="h-3.5 w-3.5" />, tone: 'secondary' },
  storage: { label: 'Storage', icon: <Upload className="h-3.5 w-3.5" />, tone: 'warning' },
  publishing: { label: 'Publishing', icon: <BookOpen className="h-3.5 w-3.5" />, tone: 'info' },
  system: { label: 'System', icon: <Bell className="h-3.5 w-3.5" />, tone: 'secondary' },
  collaboration: { label: 'Collaboration', icon: <Users className="h-3.5 w-3.5" />, tone: 'accent' },
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { success, info } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: notifications, isLoading } = useNotifications(user?.id);
  const { data: emails } = useEmails();
  const [tab, setTab] = React.useState<'all' | 'unread' | 'read' | 'email'>('all');
  const [type, setType] = React.useState<'all' | NotificationType>('all');
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const perPage = 12;

  const all = React.useMemo(() => (notifications ?? []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [notifications]);
  const unread = all.filter((notification) => !notification.read);

  const rows = React.useMemo(() => {
    return all.filter((notification) => {
      if (tab === 'unread' && notification.read) return false;
      if (tab === 'read' && !notification.read) return false;
      if (type !== 'all' && notification.type !== type) return false;
      if (query && !`${notification.title} ${notification.body}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [all, tab, type, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const visible = rows.slice((page - 1) * perPage, page * perPage);
  const myEmails = (emails ?? []).filter((email) => user && email.to === user.email);

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const open = (notification: AppNotification) => {
    if (!notification.read) notificationService.markRead(notification.id);
    refresh();
    if (notification.link) navigate(notification.link);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unread.length} unread of {all.length} total · email delivery is simulated.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { notificationService.markAllRead(user?.id as string); refresh(); success('All caught up'); }} disabled={unread.length === 0}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/dashboard/settings')}>
            <Settings className="h-4 w-4" /> Preferences
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={all.length === 0}
            onClick={async () => {
              const ok = await confirm({ title: 'Delete all notifications?', description: 'Notification history is cleared. Emails already sent are unaffected.', confirmLabel: 'Clear all', destructive: true });
              if (!ok) return;
              notificationService.clear(user?.id as string);
              refresh();
              success('Notifications cleared');
            }}
          >
            <Trash2 className="h-4 w-4" /> Clear all
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Inbox</CardTitle>
            <CardDescription>{rows.length} matching notifications</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search notifications" className="h-9 w-[210px] pl-8" aria-label="Search notifications" />
            </div>
            <select value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm" aria-label="Filter by type">
              <option value="all">All types</option>
              {Object.entries(TYPE_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={tab}
            onValueChange={(value) => { setTab(value as typeof tab); setPage(1); }}
            tabs={[
              { value: 'all', label: 'All', count: all.length },
              { value: 'unread', label: 'Unread', count: unread.length },
              { value: 'read', label: 'Read', count: all.length - unread.length },
              { value: 'email', label: 'Emails', count: myEmails.length },
            ]}
          />

          {tab === 'email' ? (
            myEmails.length === 0 ? (
              <EmptyState icon={<Mail className="h-5 w-5" />} title="No emails sent yet" description="Publishing, sales, exports and subscription events queue an email through the mock email service." />
            ) : (
              <div className="space-y-2">
                {myEmails.map((email) => (
                  <div key={email.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{email.subject}</p>
                        <p className="text-xs text-muted-foreground">To {email.toName} &lt;{email.to}&gt; · {formatDateTime(email.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={email.status === 'sent' ? 'success' : email.status === 'failed' ? 'danger' : 'warning'}>{email.status}</Badge>
                        <Badge variant="outline" className="text-2xs">{email.template}</Badge>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{email.body.slice(0, 320)}{email.body.length > 320 ? '…' : ''}</p>
                    {!email.opened && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="mt-2"
                        onClick={() => { info('Opened in the mock mail client'); qc.invalidateQueries({ queryKey: ['emails'] }); }}
                      >
                        Simulate open
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={tab === 'unread' ? <PartyPopper className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
              title={tab === 'unread' ? 'Nothing unread' : all.length === 0 ? 'No notifications yet' : 'Nothing matches your filters'}
              description={tab === 'unread' ? 'You are all caught up. New activity will appear here.' : all.length === 0 ? 'Publishing, sales, comments and AI events land here as they happen.' : 'Try another type or clear the search.'}
              actions={all.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setQuery(''); setType('all'); setTab('all'); }}>Clear filters</Button> : undefined}
            />
          ) : (
            <div className="space-y-2">
              {visible.map((notification) => {
                const meta = TYPE_META[notification.type];
                return (
                  <div key={notification.id} className={cn('flex items-start gap-3 rounded-lg border p-3 transition-colors', !notification.read && 'border-l-4 border-l-primary bg-primary/[0.03]')}>
                    <div className={cn('mt-0.5 rounded-full p-2', !notification.read ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      {meta.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('text-sm', !notification.read ? 'font-medium' : 'text-muted-foreground')}>{notification.title}</p>
                        <Badge variant={meta.tone} className="text-2xs">{meta.label}</Badge>
                        {notification.priority === 'high' && <Badge variant="danger" className="text-2xs">High priority</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{notification.body}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
                        <span>{timeAgo(notification.createdAt)}</span>
                        <span>{formatDateTime(notification.createdAt)}</span>
                        {notification.link && <span className="font-mono">{notification.link}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {notification.link && (
                        <Button variant="ghost" size="xs" onClick={() => open(notification)}>Open</Button>
                      )}
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={notification.read ? 'Mark unread' : 'Mark read'}
                        onClick={() => { notification.read ? notificationService.markUnread(notification.id) : notificationService.markRead(notification.id); refresh(); }}
                      >
                        {notification.read ? <BellRing className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label="Delete notification"
                        onClick={() => { notificationService.remove(notification.id); refresh(); info('Notification deleted'); }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab !== 'email' && rows.length > perPage && <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Type breakdown</CardTitle>
          <CardDescription>Which events generate the most noise — tune them in notification preferences.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.entries(TYPE_META).map(([key, meta]) => {
            const count = all.filter((notification) => notification.type === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setType(key as NotificationType); setTab('all'); setPage(1); }}
                className={cn('rounded-lg border p-3 text-left transition-colors', type === key ? 'border-primary bg-primary/5' : 'hover:border-primary/40')}
              >
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{meta.icon} {meta.label}</p>
                <p className="mt-1 text-lg font-semibold">{count}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5"><Filter className="h-3.5 w-3.5" /> Filters apply instantly — no page reloads.</p>
        <Button variant="ghost" size="xs" onClick={() => navigate('/dashboard/activity')}>View activity log</Button>
      </div>
    </div>
  );
}
