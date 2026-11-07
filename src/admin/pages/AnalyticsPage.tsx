import { useMemo, useState } from 'react'
import { Download, Filter, LineChart as LineChartIcon, Smartphone, TrendingUp } from 'lucide-react'
import {
  buildAnalytics,
  changePercent,
  previousRangeFor,
  rangeFor,
  totalsFor,
} from '@/admin/data/analytics'
import type { KeywordMetric, LandingMetric, ServicePerformance } from '@/admin/types/admin'
import { BarList, CHART_COLORS, ColumnChart, DonutChart, TrendChart } from '@/admin/components/charts'
import { SimulatedNotice, StatCard } from '@/admin/components/StatCard'
import { DataTable, type Column } from '@/admin/components/DataTable'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Segmented,
  SimulatedBadge,
} from '@/admin/components/ui'
import { useToast } from '@/admin/context/ToastContext'
import { useLiveAnalytics } from '@/admin/data/liveAnalytics'
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import {
  formatCompact,
  formatCurrency,
  formatNumber,
  formatPercent,
  formatShortDate,
} from '@/admin/lib/format'

type MetricKey = 'visitors' | 'calls' | 'leads' | 'revenue'

const METRIC_OPTIONS: { value: MetricKey; label: string }[] = [
  { value: 'visitors', label: 'Visitors' },
  { value: 'calls', label: 'Calls' },
  { value: 'leads', label: 'Leads' },
  { value: 'revenue', label: 'Revenue' },
]

const RANGE_OPTIONS = [7, 14, 30, 90].map((days) => ({
  value: days,
  label: `${days}d`,
}))

const download = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const AnalyticsPage = () => {
  const toast = useToast()
  const [range, setRange] = useState(30)
  const [metric, setMetric] = useState<MetricKey>('visitors')

  const { live, version, error: liveError } = useLiveAnalytics()

  const analytics = useMemo(() => buildAnalytics(90), [version])
  const daily = useMemo(() => rangeFor(range), [range, version])
  const totals = useMemo(() => totalsFor(daily), [daily])
  const previousTotals = useMemo(() => totalsFor(previousRangeFor(range)), [range, version])

  const metricColor: Record<MetricKey, string> = {
    visitors: CHART_COLORS.brand,
    calls: CHART_COLORS.success,
    leads: CHART_COLORS.violet,
    revenue: CHART_COLORS.amber,
  }

  const trendData = daily.map((row) => ({
    label: formatShortDate(row.date),
    values: {
      visitors: row.visitors,
      calls: row.calls,
      leads: row.leads,
      revenue: row.revenue,
    },
  }))

  const keywordColumns: Column<KeywordMetric>[] = [
    {
      key: 'keyword',
      header: 'Keyword',
      render: (row) => <span className="font-medium text-ink">{row.keyword}</span>,
      sortValue: (row) => row.keyword,
    },
    { key: 'clicks', header: 'Clicks', align: 'right', render: (row) => formatNumber(row.clicks), sortValue: (row) => row.clicks },
    {
      key: 'impressions',
      header: 'Impressions',
      align: 'right',
      hideBelow: 'sm',
      render: (row) => <span className="text-muted">{formatNumber(row.impressions)}</span>,
      sortValue: (row) => row.impressions,
    },
    {
      key: 'position',
      header: 'Avg. position',
      align: 'right',
      hideBelow: 'md',
      render: (row) => row.position.toFixed(1),
      sortValue: (row) => row.position,
    },
    { key: 'ctr', header: 'CTR', align: 'right', render: (row) => formatPercent(row.ctr), sortValue: (row) => row.ctr },
  ]

  const landingColumns: Column<LandingMetric>[] = [
    {
      key: 'path',
      header: 'Landing page',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.title}</p>
          <p className="truncate font-mono text-2xs text-muted">{row.path}</p>
        </div>
      ),
      sortValue: (row) => row.path,
    },
    {
      key: 'visitors',
      header: 'Visitors',
      align: 'right',
      render: (row) => formatNumber(row.visitors),
      sortValue: (row) => row.visitors,
    },
    {
      key: 'calls',
      header: 'Calls',
      align: 'right',
      hideBelow: 'sm',
      render: (row) => formatNumber(row.calls),
      sortValue: (row) => row.calls,
    },
    {
      key: 'conversion',
      header: 'Call rate',
      align: 'right',
      render: (row) => <Badge tone={row.conversion >= 3 ? 'success' : 'slate'}>{formatPercent(row.conversion)}</Badge>,
      sortValue: (row) => row.conversion,
    },
  ]

  const serviceColumns: Column<ServicePerformance>[] = [
    {
      key: 'service',
      header: 'Service',
      render: (row) => <span className="font-medium text-ink">{row.service}</span>,
      sortValue: (row) => row.service,
    },
    {
      key: 'groupId',
      header: 'Call group',
      hideBelow: 'md',
      render: (row) => (row.groupId ? <span className="font-mono text-2xs text-muted">{row.groupId}</span> : <Badge tone="amber">No line</Badge>),
      sortValue: (row) => row.groupId ?? '',
    },
    { key: 'clicks', header: 'Clicks', align: 'right', render: (row) => formatNumber(row.clicks), sortValue: (row) => row.clicks },
    {
      key: 'calls',
      header: 'Calls',
      align: 'right',
      hideBelow: 'sm',
      render: (row) => formatNumber(row.calls),
      sortValue: (row) => row.calls,
    },
    {
      key: 'leads',
      header: 'Leads',
      align: 'right',
      hideBelow: 'sm',
      render: (row) => formatNumber(row.leads),
      sortValue: (row) => row.leads,
    },
    {
      key: 'conversion',
      header: 'Conversion',
      align: 'right',
      render: (row) => formatPercent(row.conversion),
      sortValue: (row) => row.conversion,
    },
  ]

  const sourceVisitors = analytics.sources.reduce((sum, source) => sum + source.visitors, 0)
  const sourceRows = analytics.sources.map((source, index) => ({
    label: source.source,
    value: sourceVisitors > 0 ? Math.round((source.visitors / sourceVisitors) * 1000) / 10 : 0,
    color: [CHART_COLORS.brand, CHART_COLORS.slate, CHART_COLORS.amber, CHART_COLORS.violet, CHART_COLORS.success][
      index % 5
    ],
  }))

  const exportReport = () => {
    const header = 'date,visitors,pageviews,calls,leads,revenue'
    const rows = daily.map((row) => [row.date, row.visitors, row.pageViews, row.calls, row.leads, row.revenue].join(','))
    download(`safe-home-network-analytics-${range}d.csv`, [header, ...rows].join('\n'))
    toast.success(
      'Report exported',
      `CSV with ${daily.length} days of ${live ? 'recorded' : 'simulated'} data.`,
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics & reports"
        description="Traffic, call and revenue reporting with date filters and exportable detail."
        meta={live ? undefined : <SimulatedBadge />}
        actions={
          <>
            <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} ariaLabel="Report range" size="sm" />
            <Button variant="secondary" size="sm" onClick={exportReport} iconLeft={<Download className="h-3.5 w-3.5" />}>
              Export CSV
            </Button>
          </>
        }
      />

      {live ? null : <SimulatedNotice />}
      {live ? (
        <p className="mt-3 rounded-xl border border-line bg-soft px-3.5 py-2.5 text-2xs leading-relaxed text-muted">
          “Calls” on this report counts Call Now button taps recorded by the site. Connected calls and revenue are
          recorded separately and are never inferred from clicks.
        </p>
      ) : null}
      {ADMIN_CONFIG.api.enabled && liveError ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Live analytics could not be loaded ({liveError}). The figures below are demo data.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Visitors"
          value={formatNumber(totals.visitors)}
          delta={changePercent(totals.visitors, previousTotals.visitors)}
          icon={<TrendingUp className="h-4 w-4" />}
          sparkline={daily.map((row) => row.visitors)}
        />
        <StatCard
          label="Calls"
          value={formatNumber(totals.calls)}
          delta={changePercent(totals.calls, previousTotals.calls)}
          icon={<LineChartIcon className="h-4 w-4" />}
          accent="success"
          sparkline={daily.map((row) => row.calls)}
        />
        <StatCard
          label="Leads"
          value={formatNumber(totals.leads)}
          delta={changePercent(totals.leads, previousTotals.leads)}
          icon={<Filter className="h-4 w-4" />}
          accent="violet"
          sparkline={daily.map((row) => row.leads)}
        />
        <StatCard
          label="Est. revenue"
          value={formatCurrency(totals.revenue)}
          delta={changePercent(totals.revenue, previousTotals.revenue)}
          icon={<Smartphone className="h-4 w-4" />}
          accent="amber"
          sparkline={daily.map((row) => row.revenue)}
        />
      </div>

      <Card>
        <CardHeader
          title="Trend report"
          description={`${range}-day series · hover the chart for daily detail`}
          action={<Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} ariaLabel="Primary metric" size="sm" />}
        />
        <div className="px-4 pb-4 pt-3">
          <TrendChart
            data={trendData}
            series={[{ key: metric, label: METRIC_OPTIONS.find((option) => option.value === metric)?.label ?? 'Metric', color: metricColor[metric] }]}
            valueLabel={metric}
            height={240}
          />
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Traffic sources" description="Share of visitors" />
          <div className="p-5">
            <DonutChart
              data={analytics.sources.map((source, index) => ({
                name: source.source,
                value: source.visitors,
                color: [CHART_COLORS.brand, CHART_COLORS.slate, CHART_COLORS.amber, CHART_COLORS.violet, CHART_COLORS.success][index],
              }))}
              centerLabel="visitors"
              centerValue={formatCompact(analytics.sources.reduce((sum, row) => sum + row.visitors, 0))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Channel share" description="Percent of all sessions" />
          <div className="p-5">
            <BarList rows={sourceRows} formatValue={(value) => `${value}%`} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Device mix" description="Mobile-first audience" />
          <div className="p-5">
            <ColumnChart
              data={analytics.devices.map((device, index) => ({
                label: device.name,
                value: device.share,
                color: [CHART_COLORS.brand, CHART_COLORS.violet, CHART_COLORS.amber][index],
              }))}
              formatValue={(value) => `${value}%`}
              height={150}
            />
            <ul className="mt-3 space-y-1 text-2xs text-muted">
              {analytics.devices.map((device) => (
                <li key={device.name} className="flex justify-between">
                  <span>{device.name}</span>
                  <span className="font-semibold text-ink">{device.share}%</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Search keywords" description="Queries that produced clicks in the period" />
        <DataTable
          rows={analytics.keywords}
          columns={keywordColumns}
          rowKey={(row) => row.keyword}
          searchText={(row) => row.keyword}
          searchPlaceholder="Search keywords…"
          pageSize={6}
          initialSort={{ key: 'clicks', direction: 'desc' }}
          caption="Search keyword performance"
        />
      </Card>

      <Card>
        <CardHeader title="Landing pages" description="Entry pages and their call rate" />
        <DataTable
          rows={analytics.landingPages}
          columns={landingColumns}
          rowKey={(row) => row.path}
          searchText={(row) => `${row.title} ${row.path}`}
          searchPlaceholder="Search landing pages…"
          pageSize={6}
          initialSort={{ key: 'visitors', direction: 'desc' }}
          caption="Landing page performance"
        />
      </Card>

      <Card>
        <CardHeader title="Service-wise performance" description="Clicks, calls and leads per category" />
        <DataTable
          rows={analytics.services}
          columns={serviceColumns}
          rowKey={(row) => row.serviceId}
          searchText={(row) => `${row.service} ${row.groupId ?? ''}`}
          searchPlaceholder="Search services…"
          pageSize={8}
          initialSort={{ key: 'calls', direction: 'desc' }}
          caption="Service performance"
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Top states" description="Calls and leads by inferred state" />
          <div className="p-5">
            <BarList
              rows={analytics.topStates.map((row) => ({
                label: row.state,
                value: row.calls,
                secondary: row.leads,
                color: CHART_COLORS.brand,
                hint: `${row.leads} leads`,
              }))}
              formatValue={(value) => formatNumber(value)}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Call tracking numbers" description="Connected calls per line" />
          <div className="p-5">
            <BarList
              rows={[...analytics.numbers]
                .sort((a, b) => b.calls - a.calls)
                .slice(0, 10)
                .map((row) => ({
                  label: `${row.number} · ${row.group}`,
                  value: row.calls,
                  secondary: row.connected,
                  color: row.status === 'active' ? CHART_COLORS.success : CHART_COLORS.slate,
                }))}
              formatValue={(value) => formatNumber(value)}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
