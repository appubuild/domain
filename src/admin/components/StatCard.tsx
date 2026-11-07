import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import { Sparkline } from './charts'
import { cn } from './ui'

export const StatCard = ({
  label,
  value,
  delta,
  deltaLabel = 'vs previous period',
  icon,
  sparkline,
  footer,
  accent = 'brand',
}: {
  label: string
  value: string
  delta?: number
  deltaLabel?: string
  icon: ReactNode
  sparkline?: number[]
  footer?: ReactNode
  accent?: 'brand' | 'success' | 'amber' | 'violet'
}) => {
  const positive = (delta ?? 0) >= 0
  const flat = Math.abs(delta ?? 0) < 0.05
  const TrendIcon = flat ? Minus : positive ? ArrowUpRight : ArrowDownRight
  const accents: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300',
    success: 'bg-success-50 text-success-600 dark:bg-success-700/20 dark:text-success-300',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-600/15 dark:text-amber-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accents[accent])}>{icon}</span>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight text-ink tabular-nums">{value}</p>
      {delta !== undefined ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-2xs">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
              flat
                ? 'bg-soft text-muted'
                : positive
                  ? 'bg-success-50 text-success-700 dark:bg-success-700/20 dark:text-success-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {Math.abs(delta).toFixed(1)}%
          </span>
          <span className="text-muted">{deltaLabel}</span>
        </div>
      ) : null}
      {sparkline ? <Sparkline values={sparkline} className="mt-2 h-8" /> : null}
      {footer ? <div className="mt-2 border-t border-line pt-2 text-2xs text-muted">{footer}</div> : null}
    </div>
  )
}

export const SimulatedNotice = ({ className, compact = false }: { className?: string; compact?: boolean }) => (
  <div
    className={cn(
      'flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/80 px-3.5 py-2.5 dark:border-amber-700/40 dark:bg-amber-600/10',
      className,
    )}
    role="note"
  >
    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
    <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
      <span className="font-semibold">Simulated analytics.</span>{' '}
      {compact
        ? 'Sample data for the admin preview — not real traffic, calls or revenue.'
        : 'Every figure on this screen is generated sample data for the admin preview. Nothing here reflects real website traffic, call-network activity or revenue. Phase 2 replaces it with the PHP + MySQL reporting API.'}
    </p>
  </div>
)
