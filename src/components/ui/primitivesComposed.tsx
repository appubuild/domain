import * as React from 'react';
import { cn } from '@/lib/utils';

export { Badge, Button, Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from './primitives';

/**
 * Presentational table used by marketing pages and dashboards for static tabular content.
 * Interactive data grids use DataTable from '@/components/ui/data'.
 */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border bg-card', className)}>
      <table className="w-full min-w-[520px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-border bg-muted/50">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TR({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>;
}

export function TH({ children, className, align = 'left' }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ children, className, align = 'left' }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-sm text-muted-foreground',
        align === 'right' && 'text-right tabular-nums',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}
