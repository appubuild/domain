import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  MousePointerClick,
  PhoneCall,
  RefreshCw,
  Users,
  UserRoundCheck,
} from 'lucide-react'
import { repository } from '@/admin/data/repository'
import { storageKey, ADMIN_CONFIG } from '@/admin/config/adminConfig'
import { readJSON, writeJSON } from '@/admin/data/storage'
import { buildAnalytics, changePercent, previousRangeFor, rangeFor, totalsFor } from '@/admin/data/analytics'
import { useLiveAnalytics } from '@/admin/data/liveAnalytics'
import { leadStatusTone, directoryHealth } from '@/admin/lib/selectors'
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatShortDate,
  timeAgo,
} from '@/admin/lib/format'
import type {
  ActivityEntry,
  AdminPreferences,
  LeadRecord,
  ServiceRecord,
  TrackingNumber,
} from '@/admin/types/admin'
import { BarList, CHART_COLORS, DonutChart, TrendChart } from '@/admin/components/charts'
import { SimulatedNotice, StatCard } from '@/admin/components/StatCard'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Segmented,
  SimulatedBadge,
  cn,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'

const PREFERENCES_KEY = storageKey(ADMIN_CONFIG.storage.preferences)

const rangeOptions = ADMIN_CONFIG.analytics.ranges.map((days) => ({
  value: days,
  label: days === 7 ? '7 days' : days === 14 ? '14 days' : days === 30 ? '30 days' : '90 days',
}))

export const DashboardPage = () => {
  const toast = useToast()
  const [range, setRange] = useState<number>(() => readJSON<AdminPreferences>(PREFERENCES_KEY, {
    sidebarCollapsed: false,
    dashboardRange: ADMIN_CONFIG.analytics.defaultRangeDays,
  }).dashboardRange)
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [numbers, setNumbers] = useState<TrackingNumber[]>([])
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [refreshedAt, setRefreshedAt] = useState<string>(new Date().toISOString())

  const load = useCallback(() => {
    Promise.all([repository.listServices(), repository.listNumbers(), repository.listLeads(), repository.listActivity()])
      .then(([serviceRows, numberRows, leadRows, activityRows]) => {
        setServices(serviceRows)
        setNumbers(numberRows)
        setLeads(leadRows)
        setActivity(activityRows)
      })
      .catch(() => toast.error('Could not load dashboard data'))
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const { live, version, error: liveError } = useLiveAnalytics()

  const analytics = useMemo(() => buildAnalytics(90), [refreshedAt, version])
  const daily = useMemo(() => rangeFor(range), [range, version])
  const previous = useMemo(() => previousRangeFor(range), [range, version])
  const totals = useMemo(() => totalsFor(daily), [daily])
  const previousTotals = useMemo(() => totalsFor(previous), [previous])
  const today = daily[daily.length - 1]
  const week = totalsFor(rangeFor(7))
  const month = totalsFor(rangeFor(30))
  const health = useMemo(() => directoryHealth(services, numbers), [services, numbers])

  const trendData = useMemo(
    () =>
      daily.map((row) => ({
        label: formatShortDate(row.date),
        values: { visitors: row.visitors, calls: row.calls, leads: row.leads },
      })),
    [daily],
  )

  const sourceData = analytics.sources.map((source, index) => ({
    name: source.source,
    value: source.visitors,
    color: [CHART_COLORS.brand, CHART_COLORS.slate, CHART_COLORS.amber, CHART_COLORS.violet, CHART_COLORS.success][index],
  }))

  const topNumbers = [...analytics.numbers].sort((a, b) => b.calls - a.calls).slice(0, 6)
  const topServices = [...analytics.services].sort((a, b) => b.calls - a.calls).slice(0, 8)
  const recentLeads = leads.slice(0, 5)

  const changeRange = (value: number) => {
    setRange(value)
    const preferences = readJSON<AdminPreferences>(PREFERENCES_KEY, {
      sidebarCollapsed: false,
      dashboardRange: value,
    })
    writeJSON(PREFERENCES_KEY, { ...preferences, dashboardRange: value })
  }

  const refresh = () => {
    setRefreshedAt(new Date().toISOString())
    load()
    toast.success(
      'Dashboard refreshed',
      live ? 'Analytics reloaded from the API.' : 'Simulated data regenerated for the selected range.',
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Directory health, call performance and traffic at a glance."
        meta={
          <>
            {live ? null : <SimulatedBadge />}
            <span>Updated {timeAgo(refreshedAt)}</span>
          </>
        }
        actions={
          <>
            <Segmented options={rangeOptions} value={range} onChange={changeRange} ariaLabel="Dashboard date range" size="sm" />
            <Button variant="secondary" size="sm" onClick={refresh} iconLeft={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
            <Link to="/admin/analytics">
              <Button size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>Full report</Button>
            </Link>
          </>
        }
      />

      {live ? null : <SimulatedNotice compact />}
      {ADMIN_CONFIG.api.enabled && liveError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Live analytics could not be loaded ({liveError}). The figures below are demo data.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Visitors · ${range}d`}
          value={formatNumber(totals.visitors)}
          delta={changePercent(totals.visitors, previousTotals.visitors)}
          icon={<Users className="h-4 w-4" />}
          sparkline={daily.map((row) => row.visitors)}
          footer={`${formatNumber(today.visitors)} today · ${formatNumber(totals.pageViews)} page views`}
        />
        <StatCard
          label={live ? `Call clicks · ${range}d` : `Calls · ${range}d`}
          value={formatNumber(totals.calls)}
          delta={changePercent(totals.calls, previousTotals.calls)}
          icon={<PhoneCall className="h-4 w-4" />}
          sparkline={daily.map((row) => row.calls)}
          accent="success"
          footer={
            live
              ? `${formatNumber(today.calls)} today · ${formatPercent(totals.conversion)} of visitors clicked`
              : `${formatNumber(today.calls)} today · ${formatPercent(totals.conversion)} of visitors`
          }
        />
        <StatCard
          label={`Leads · ${range}d`}
          value={formatNumber(totals.leads)}
          delta={changePercent(totals.leads, previousTotals.leads)}
          icon={<UserRoundCheck className="h-4 w-4" />}
          sparkline={daily.map((row) => row.leads)}
          accent="violet"
          footer={`${recentLeads.filter((lead) => lead.status === 'new').length} awaiting first contact`}
        />
        <StatCard
          label={live ? `Revenue · ${range}d` : `Est. revenue · ${range}d`}
          value={formatCurrency(totals.revenue)}
          delta={changePercent(totals.revenue, previousTotals.revenue)}
          icon={<CircleDollarSign className="h-4 w-4" />}
          sparkline={daily.map((row) => row.revenue)}
          accent="amber"
          footer={
            live
              ? `${formatNumber(totals.calls)} recorded calls · ${formatNumber(totals.leads)} leads`
              : `Simulated value · ${formatCurrency(totals.revenue / Math.max(1, totals.calls))} per call`
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={live ? 'Traffic, call clicks and leads' : 'Traffic, calls and leads'}
            description={`Daily performance over the last ${range} days`}
            action={live ? <Badge tone="success">Live</Badge> : <Badge tone="amber">Simulated</Badge>}
          />
          <div className="px-4 pb-4 pt-3">
            <TrendChart
              data={trendData}
              series={[
                { key: 'visitors', label: 'Visitors', color: CHART_COLORS.brand },
                { key: 'calls', label: 'Calls', color: CHART_COLORS.success },
                { key: 'leads', label: 'Leads', color: CHART_COLORS.violet },
              ]}
              valueLabel="Traffic"
              height={270}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Traffic snapshot" description="Today, this week and this month" />
          <div className="divide-y divide-line">
            {[
              { label: 'Today', data: { visitors: today.visitors, calls: today.calls, leads: today.leads } },
              { label: 'Last 7 days', data: week },
              { label: 'Last 30 days', data: month },
            ].map((row) => (
              <div key={row.label} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink">{row.label}</p>
                  {live ? <Badge tone="success">recorded</Badge> : <Badge tone="slate">simulated</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Visitors</dt>
                    <dd className="font-display text-sm font-bold text-ink tabular-nums">{formatCompact(row.data.visitors)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Calls</dt>
                    <dd className="font-display text-sm font-bold text-ink tabular-nums">{formatCompact(row.data.calls)}</dd>
                  </div>
                  <div>
                    <dt className="text-2xs uppercase tracking-wide text-muted">Leads</dt>
                    <dd className="font-display text-sm font-bold text-ink tabular-nums">{formatCompact(row.data.leads)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-5 py-3">
            <p className="flex items-center gap-1.5 text-2xs text-muted">
              <CalendarDays className="h-3.5 w-3.5" /> Range filter applies to the cards and charts above.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Traffic sources" description="Where visitors came from" />
          <div className="p-5">
            <DonutChart
              data={sourceData}
              centerLabel="visitors"
              centerValue={formatCompact(sourceData.reduce((sum, row) => sum + row.value, 0))}
            />
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Call tracking numbers"
            description="Calls per published line, ranked"
            action={
              <Link to="/admin/numbers">
                <Button variant="ghost" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>Manage</Button>
              </Link>
            }
          />
          <div className="p-5">
            <BarList
              rows={topNumbers.map((row) => ({
                label: `${row.number} · ${row.group}`,
                value: row.calls,
                secondary: row.connected,
                color: row.status === 'active' ? CHART_COLORS.brand : CHART_COLORS.slate,
                hint: `${row.connected} connected calls · ${row.durationMin} talk minutes`,
              }))}
              formatValue={(value) => formatCompact(value)}
            />
            <p className="mt-3 text-2xs text-muted">
              Second figure = connected calls.{' '}
              {live ? 'Taken from recorded call records.' : 'All values are simulated.'}
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Service performance"
            description="Clicks and calls per service category"
            action={
              <Link to="/admin/services">
                <Button variant="ghost" size="sm">Services</Button>
              </Link>
            }
          />
          <div className="p-5">
            <BarList
              rows={topServices.map((row) => ({
                label: row.service,
                value: row.calls,
                secondary: row.clicks,
                color: row.groupId ? CHART_COLORS.brand : CHART_COLORS.slate,
                hint: `${row.clicks} clicks · ${row.leads} leads · ${formatPercent(row.conversion)} conversion`,
              }))}
              formatValue={(value) => formatCompact(value)}
            />
            <p className="mt-3 text-2xs text-muted">Second figure = call-button clicks. Services with no line show zero calls.</p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Search keywords"
            description="Top queries sending traffic"
            action={live ? <Badge tone="success">Live</Badge> : <Badge tone="amber">Simulated</Badge>}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-soft/60 text-2xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 text-left font-semibold">Keyword</th>
                  <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                  <th className="px-3 py-2 text-right font-semibold">Pos.</th>
                  <th className="px-5 py-2 text-right font-semibold">CTR</th>
                </tr>
              </thead>
              <tbody>
                {analytics.keywords.slice(0, 6).map((keyword) => (
                  <tr key={keyword.keyword} className="border-b border-line/70 last:border-0">
                    <td className="max-w-[14rem] truncate px-5 py-2.5 font-medium text-ink" title={keyword.keyword}>
                      {keyword.keyword}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{formatCompact(keyword.clicks)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{keyword.position.toFixed(1)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-ink">{formatPercent(keyword.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent leads"
            description="Newest enquiries from the contact form"
            action={
              <Link to="/admin/leads">
                <Button variant="ghost" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>Inbox</Button>
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {recentLeads.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-2xs font-bold text-muted">
                  {lead.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{lead.name}</p>
                  <p className="truncate text-2xs text-muted">
                    {lead.service} · {lead.source} · {timeAgo(lead.createdAt)}
                  </p>
                </div>
                <Badge tone={leadStatusTone[lead.status]}>{lead.status}</Badge>
              </li>
            ))}
            {recentLeads.length === 0 ? <li className="px-5 py-6 text-sm text-muted">No leads yet.</li> : null}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Directory health" description="Live mapping from the website data" />
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line">
              {[
                { label: 'Services', value: `${health.publishedServices}/${health.services}`, hint: 'published' },
                { label: 'Numbers', value: `${health.activeNumbers}/${health.numbers}`, hint: 'active' },
                { label: 'Groups', value: String(health.groups), hint: 'directory groups' },
                { label: 'No line yet', value: String(health.servicesWithoutNumbers), hint: 'services' },
              ].map((row) => (
                <div key={row.label} className="bg-surface px-4 py-3">
                  <dt className="text-2xs uppercase tracking-wide text-muted">{row.label}</dt>
                  <dd className="font-display text-lg font-bold text-ink tabular-nums">{row.value}</dd>
                  <p className="text-2xs text-muted">{row.hint}</p>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Activity" description="Latest admin actions" action={<Activity className="h-4 w-4 text-muted" />} />
            <ul className="divide-y divide-line">
              {activity.slice(0, 5).map((entry) => (
                <li key={entry.id} className="px-5 py-2.5">
                  <p className="text-xs text-ink">
                    <span className="font-semibold">{entry.action}</span>{' '}
                    <span className="text-muted">{entry.target}</span>
                  </p>
                  <p className="text-2xs text-muted">
                    {entry.actor} · {timeAgo(entry.at)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <p className={cn('flex items-center gap-1.5 text-2xs text-muted')}>
        <MousePointerClick className="h-3.5 w-3.5" />
        {live
          ? 'Directory figures are read from the API; traffic, call and revenue figures are recorded events.'
          : 'Service and number figures come from the demo workspace; traffic and revenue figures come from the simulated analytics module.'}
      </p>
    </div>
  )
}
