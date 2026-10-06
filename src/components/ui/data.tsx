import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button, Card, Skeleton } from './primitives';

/* ------------------------------------------------------------------- table */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  sort,
  onSortChange,
  onRowClick,
  loading,
  emptyState,
  rowClassName,
  dense,
  selectable,
  selectedKeys,
  onSelectionChange,
  actions,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyState?: React.ReactNode;
  rowClassName?: (row: T) => string;
  dense?: boolean;
  /** Enables checkbox selection with an accessible header toggle. */
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Optional per-row action cell, typically a dropdown menu. */
  actions?: (row: T) => React.ReactNode;
  /** Row identity accessor; falls back to `row.id`. */
  rowKey?: (row: T) => string;
}) {
  const keyFor = (row: T, index: number) => rowKey?.(row) ?? row.id ?? String(index);
  const allSelected = selectable && rows.length > 0 && rows.every((row, index) => selectedKeys?.includes(keyFor(row, index)));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : rows.map((row, index) => keyFor(row, index)));
  };
  const toggleRow = (key: string) => {
    if (!onSelectionChange) return;
    const current = selectedKeys ?? [];
    onSelectionChange(current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]);
  };
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!rows.length && emptyState) return <>{emptyState}</>;

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left">
            {selectable && (
              <th scope="col" className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={Boolean(allSelected)}
                  onChange={toggleAll}
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                  className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                />
              </th>
            )}
            {actions && <th scope="col" className="w-10 px-2 py-2.5"><span className="sr-only">Actions</span></th>}
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width }}
                className={cn(
                  'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.className,
                )}
              >
                {column.sortable && onSortChange ? (
                  <button type="button" onClick={() => onSortChange(column.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {column.header}
                    <span className={cn('text-[10px]', sort?.key === column.key ? 'text-primary' : 'opacity-40')}>
                      {sort?.key === column.key && sort.dir === 'desc' ? '▼' : '▲'}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = keyFor(row, index);
            const isSelected = Boolean(selectedKeys?.includes(key));
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-border/70 transition-colors last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-muted/50',
                  isSelected && 'bg-primary/5',
                  rowClassName?.(row),
                )}
              >
                {selectable && (
                  <td className={cn('px-4', dense ? 'py-2' : 'py-3')} onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(key)}
                      aria-label={`Select row ${index + 1}`}
                      className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                    />
                  </td>
                )}
                {actions && (
                  <td className={cn('px-2', dense ? 'py-2' : 'py-3')} onClick={(event) => event.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      dense ? 'px-4 py-2' : 'px-4 py-3',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------- empty states */

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 19.5V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2.5Z" />
          </svg>
        )}
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>}
      <div className="mt-5 flex gap-2">
        {onRetry && (
          <Button size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      <span className="mt-0.5 text-destructive">⚠</span>
      <div className="flex-1">
        <p className="text-sm text-foreground">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 text-xs font-semibold text-primary hover:underline">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- stat cards */

export function StatCard({
  label,
  value,
  change,
  hint,
  icon,
  tone = 'default',
  className,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  change?: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  /** When provided the card becomes an actionable, keyboard-focusable tile. */
  onClick?: () => void;
}) {
  const tones = {
    default: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/15',
    danger: 'text-destructive bg-destructive/10',
    info: 'text-info bg-info/10',
  };
  const positive = change?.startsWith('+');
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('block w-full text-left', onClick && 'transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      <Card className={cn('p-4', className)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          </div>
          {icon && <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>}
        </div>
        {(change || hint) && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            {change && <span className={cn('font-medium', positive ? 'text-success' : 'text-destructive')}>{change}</span>}
            {hint && <span className="text-muted-foreground">{hint}</span>}
          </div>
        )}
      </Card>
    </Wrapper>
  );
}

export function UsageMeter({
  label,
  used,
  limit,
  format,
  tone = 'primary',
  action,
}: {
  label: string;
  used: number;
  limit: number | string;
  format?: (value: number) => string;
  tone?: 'primary' | 'warning' | 'danger' | 'success';
  action?: React.ReactNode;
}) {
  const numericLimit = typeof limit === 'number' ? limit : Number(limit);
  const percent = numericLimit > 0 ? Math.min(100, (used / numericLimit) * 100) : 0;
  const tones = {
    primary: 'bg-primary',
    warning: 'bg-warning',
    danger: 'bg-destructive',
    success: 'bg-success',
  };
  const effectiveTone = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : tone;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {format ? format(used) : used.toLocaleString()} / {typeof limit === 'number' && limit < 0 ? '∞' : format ? format(numericLimit) : numericLimit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-[width] duration-500', tones[effectiveTone])} style={{ width: `${percent}%` }} />
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------- misc */

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {index > 0 && <span className="opacity-50">/</span>}
          {item.href && index < items.length - 1 ? (
            <a href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </a>
          ) : (
            <span className={index === items.length - 1 ? 'font-medium text-foreground' : ''}>{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function Pagination({
  page,
  pageCount,
  onPageChange,
  total,
  pageSize = 12,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total ?? pageCount * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {total !== undefined ? `${from}–${to} of ${total}` : `Page ${page} of ${pageCount}`}
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          {page} / {pageCount}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function Accordion({ items, className }: { items: { id: string; title: React.ReactNode; content: React.ReactNode }[]; className?: string }) {
  const [open, setOpen] = React.useState<string[]>([]);
  return (
    <div className={cn('divide-y divide-border overflow-hidden rounded-xl border border-border bg-card', className)}>
      {items.map((item) => {
        const isOpen = open.includes(item.id);
        return (
          <div key={item.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((current) => (isOpen ? current.filter((id) => id !== item.id) : [...current, item.id]))}
              className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
            >
              <span className="text-sm font-medium text-foreground">{item.title}</span>
              <span className={cn('shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}>▾</span>
            </button>
            {isOpen && <div className="animate-fade-in px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{item.content}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Stepper({
  steps,
  current,
  onSelect,
  completed,
}: {
  steps: { id: string; label: string; description?: string }[];
  current: string;
  onSelect?: (id: string) => void;
  completed?: string[];
}) {
  return (
    <ol className="flex flex-wrap gap-1.5 lg:flex-col">
      {steps.map((step, index) => {
        const isCurrent = step.id === current;
        const isDone = completed?.includes(step.id);
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                isCurrent ? 'bg-primary/10 text-foreground' : 'hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isCurrent ? 'bg-primary text-primary-foreground' : isDone ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {isDone && !isCurrent ? '✓' : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{step.label}</span>
                {step.description && <span className="hidden text-xs text-muted-foreground lg:block">{step.description}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function SkeletonCard() {
  return (
    <Card className="p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-32" />
      <Skeleton className="mt-3 h-3 w-full" />
    </Card>
  );
}

export function ProgressList({ items }: { items: { label: string; value: number; hint?: string }[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-foreground">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{item.hint ?? `${item.value}%`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${item.value}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
