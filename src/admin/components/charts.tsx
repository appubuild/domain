/**
 * Dependency-free SVG charts.
 *
 * Written by hand so the admin console adds no chart library to the bundle and
 * inherits the site's design tokens. All charts are interactive (hover / focus)
 * and readable without colour alone (values are always labelled in a legend or
 * axis).
 */
import { useId, useMemo, useState } from 'react'
import { cn } from './ui'

export const CHART_COLORS = {
  brand: '#2563eb',
  success: '#16a34a',
  amber: '#f59e0b',
  violet: '#7c3aed',
  rose: '#e11d48',
  slate: '#64748b',
}

export interface TrendSeries {
  key: string
  label: string
  color: string
}

export interface TrendPoint {
  label: string
  values: Record<string, number>
}

const buildPath = (points: { x: number; y: number }[], smooth: boolean): string => {
  if (points.length === 0) return ''
  if (!smooth || points.length < 3) {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')
  }
  let path = `M${points[0].x},${points[0].y}`
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const midX = (previous.x + current.x) / 2
    path += ` C${midX},${previous.y} ${midX},${current.y} ${current.x},${current.y}`
  }
  return path
}

export const TrendChart = ({
  data,
  series,
  height = 260,
  valueLabel = 'Value',
}: {
  data: TrendPoint[]
  series: TrendSeries[]
  height?: number
  valueLabel?: string
}) => {
  const gradientId = useId()
  const [active, setActive] = useState<number | null>(null)

  const width = 760
  const padding = { top: 16, right: 16, bottom: 28, left: 44 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const max = useMemo(() => {
    const highest = Math.max(
      1,
      ...data.flatMap((point) => series.map((entry) => point.values[entry.key] ?? 0)),
    )
    return Math.ceil(highest / 10) * 10
  }, [data, series])

  const xFor = (index: number): number =>
    data.length <= 1 ? padding.left : padding.left + (index / (data.length - 1)) * innerWidth
  const yFor = (value: number): number => padding.top + innerHeight - (value / max) * innerHeight

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio))
  const xTickIndexes = useMemo(() => {
    if (data.length === 0) return []
    const count = Math.min(6, data.length)
    return Array.from({ length: count }, (_, index) =>
      Math.round((index / Math.max(1, count - 1)) * (data.length - 1)),
    )
  }, [data.length])

  const activePoint = active === null ? null : data[active]

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5 text-2xs font-semibold text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${valueLabel} trend chart`}
        onMouseLeave={() => setActive(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - rect.left) / rect.width
          const svgX = ratio * width
          const index = Math.round(((svgX - padding.left) / innerWidth) * (data.length - 1))
          setActive(Math.max(0, Math.min(data.length - 1, index)))
        }}
      >
        <defs>
          {series.map((entry) => (
            <linearGradient key={entry.key} id={`${gradientId}-${entry.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={entry.color} stopOpacity="0.24" />
              <stop offset="100%" stopColor={entry.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="stroke-line"
              strokeDasharray="3 5"
              strokeWidth="1"
            />
            <text x={padding.left - 8} y={yFor(tick) + 3} textAnchor="end" className="fill-muted text-[10px]">
              {tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : tick}
            </text>
          </g>
        ))}

        {series.map((entry) => {
          const points = data.map((point, index) => ({
            x: xFor(index),
            y: yFor(point.values[entry.key] ?? 0),
          }))
          const line = buildPath(points, true)
          return (
            <g key={entry.key}>
              <path
                d={`${line} L${xFor(data.length - 1)},${padding.top + innerHeight} L${xFor(0)},${padding.top + innerHeight} Z`}
                fill={`url(#${gradientId}-${entry.key})`}
              />
              <path d={line} fill="none" stroke={entry.color} strokeWidth="2.2" strokeLinecap="round" />
            </g>
          )
        })}

        {xTickIndexes.map((index) => (
          <text
            key={index}
            x={xFor(index)}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
            className="fill-muted text-[10px]"
          >
            {data[index]?.label}
          </text>
        ))}

        {active !== null && activePoint ? (
          <g>
            <line
              x1={xFor(active)}
              x2={xFor(active)}
              y1={padding.top}
              y2={padding.top + innerHeight}
              className="stroke-muted/40"
              strokeWidth="1"
            />
            {series.map((entry) => (
              <circle
                key={entry.key}
                cx={xFor(active)}
                cy={yFor(activePoint.values[entry.key] ?? 0)}
                r="3.5"
                fill={entry.color}
                stroke="white"
                strokeWidth="1.5"
              />
            ))}
          </g>
        ) : null}
      </svg>

      {active !== null && activePoint ? (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-[9rem] rounded-xl border border-line bg-surface p-2.5 shadow-float"
          style={{
            left: `${Math.min(78, Math.max(2, ((active + 0.5) / Math.max(1, data.length)) * 100))}%`,
          }}
        >
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{activePoint.label}</p>
          <ul className="mt-1 space-y-0.5">
            {series.map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                  {entry.label}
                </span>
                <span className="font-semibold text-ink">
                  {(activePoint.values[entry.key] ?? 0).toLocaleString('en-US')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export const Sparkline = ({
  values,
  color = CHART_COLORS.brand,
  className,
}: {
  values: number[]
  color?: string
  className?: string
}) => {
  const width = 120
  const height = 36
  if (values.length === 0) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = Math.max(1, max - min)
  const points = values.map((value, index) => ({
    x: (index / Math.max(1, values.length - 1)) * width,
    y: height - 3 - ((value - min) / span) * (height - 8),
  }))
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('h-9 w-full', className)} aria-hidden="true">
      <path d={buildPath(points, true)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export const BarList = ({
  rows,
  formatValue = (value: number) => value.toLocaleString('en-US'),
}: {
  rows: { label: string; value: number; secondary?: number; color?: string; hint?: string }[]
  formatValue?: (value: number) => string
}) => {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label} className="group">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-medium text-ink" title={row.hint ?? row.label}>
              {row.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-muted">
              {formatValue(row.value)}
              {row.secondary !== undefined ? (
                <span className="ml-2 font-normal text-muted/80">{formatValue(row.secondary)}</span>
              ) : null}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-soft">
            <div
              className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: row.color ?? CHART_COLORS.brand,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export const DonutChart = ({
  data,
  size = 168,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number; color: string }[]
  size?: number
  centerLabel?: string
  centerValue?: string
}) => {
  const [active, setActive] = useState<string | null>(null)
  const total = data.reduce((sum, row) => sum + row.value, 0) || 1
  const radius = 60
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Traffic source split">
        <circle cx="80" cy="80" r={radius} fill="none" strokeWidth="18" className="stroke-soft" />
        {data.map((row) => {
          const fraction = row.value / total
          const dash = fraction * circumference
          const circle = (
            <circle
              key={row.name}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth={active === row.name ? 22 : 18}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
              strokeLinecap="butt"
              onMouseEnter={() => setActive(row.name)}
              onMouseLeave={() => setActive(null)}
              className="cursor-pointer transition-all"
              opacity={active && active !== row.name ? 0.45 : 1}
            >
              <title>{`${row.name}: ${Math.round(fraction * 100)}%`}</title>
            </circle>
          )
          offset += dash
          return circle
        })}
        <text x="80" y="76" textAnchor="middle" className="fill-ink text-[15px] font-bold">
          {active ? `${Math.round(((data.find((row) => row.name === active)?.value ?? 0) / total) * 100)}%` : centerValue}
        </text>
        <text x="80" y="94" textAnchor="middle" className="fill-muted text-[9px] uppercase tracking-wide">
          {active ?? centerLabel}
        </text>
      </svg>
      <ul className="min-w-[9rem] flex-1 space-y-1.5">
        {data.map((row) => (
          <li
            key={row.name}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition',
              active === row.name ? 'bg-soft' : 'hover:bg-soft/60',
            )}
            onMouseEnter={() => setActive(row.name)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <span className="truncate text-muted">{row.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {Math.round((row.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const ColumnChart = ({
  data,
  height = 180,
  formatValue = (value: number) => value.toLocaleString('en-US'),
}: {
  data: { label: string; value: number; color?: string }[]
  height?: number
  formatValue?: (value: number) => string
}) => {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((row) => row.value))
  return (
    <div className="relative">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((row, index) => (
          <div
            key={row.label}
            className="group flex h-full flex-1 flex-col justify-end"
            onMouseEnter={() => setActive(index)}
            onMouseLeave={() => setActive(null)}
            title={`${row.label}: ${formatValue(row.value)}`}
          >
            <div
              className={cn('w-full rounded-t-md transition-all', active === index ? 'opacity-100' : 'opacity-85')}
              style={{
                height: `${Math.max(2, (row.value / max) * 100)}%`,
                backgroundColor: row.color ?? CHART_COLORS.brand,
              }}
            />
            <span className="mt-1.5 truncate text-center text-[10px] text-muted">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
