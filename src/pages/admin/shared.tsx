import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Input } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/providers/AuthProvider';
import { cn } from '@/lib/utils';

/** The acting admin, resolved from the session so audit logs always have an actor. */
export function useAdminActor() {
  const { user } = useAuth();
  return React.useMemo(() => ({ id: user?.id ?? 'user_admin', name: user?.name ?? 'Admin' }), [user?.id, user?.name]);
}

/**
 * Wraps an admin mutation with toast feedback and query invalidation so every
 * admin screen refreshes from the repository instead of patching local state.
 */
export function useAdminAction<TArgs, TResult>(
  run: (args: TArgs) => Promise<TResult> | TResult,
  options: { success: string | ((result: TResult, args: TArgs) => string); detail?: string; invalidate?: ReadonlyArray<readonly unknown[]> },
) {
  const qc = useQueryClient();
  const { success, error } = useToast();
  return useMutation({
    mutationFn: async (args: TArgs) => run(args),
    onSuccess: (result, args) => {
      success(typeof options.success === 'function' ? options.success(result, args) : options.success, options.detail);
      (options.invalidate ?? []).forEach((queryKey) => void qc.invalidateQueries({ queryKey }));
    },
    onError: (mutationError: Error) => error('Action failed', mutationError.message),
  });
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export function FilterInput({ value, onChange, placeholder, label }: { value: string; onChange: (next: string) => void; placeholder: string; label: string }) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="h-9 w-full sm:w-64"
    />
  );
}

export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (next: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="h-9 rounded-md border border-input bg-background px-2 text-xs"
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

export function StatusPill({ value, tone }: { value: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const resolved = tone ?? inferTone(value);
  return <Badge variant={resolved === 'neutral' ? 'outline' : resolved} className="text-2xs capitalize">{value.replace(/[-_]/g, ' ')}</Badge>;
}

function inferTone(value: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const normalised = value.toLowerCase();
  if (['active', 'completed', 'published', 'approved', 'resolved', 'passed', 'paid', 'live', 'verified'].includes(normalised)) return 'success';
  if (['pending', 'draft', 'drafting', 'warning', 'investigating', 'review', 'trialing', 'paused'].includes(normalised)) return 'warning';
  if (['suspended', 'failed', 'blocked', 'error', 'open', 'refunded', 'hidden', 'deleted', 'cancelled'].includes(normalised)) return 'danger';
  if (['admin', 'moderator', 'featured', 'beta'].includes(normalised)) return 'info';
  return 'neutral';
}

export function DangerButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return <Button size="xs" variant="destructive" onClick={onClick} aria-label={label}>{children}</Button>;
}

export function KeyValue({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <p key={row.label} className="flex items-start justify-between gap-3 border-b py-1 text-xs last:border-0">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="text-right font-medium">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

export const BOOK_STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'trashed', label: 'Trashed' },
];

export const ROLE_FILTERS = [
  { value: 'all', label: 'All roles' },
  { value: 'user', label: 'Users' },
  { value: 'author', label: 'Authors' },
  { value: 'moderator', label: 'Moderators' },
  { value: 'admin', label: 'Admins' },
];
