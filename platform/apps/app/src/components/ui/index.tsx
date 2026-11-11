import * as React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, AlertTriangle, Inbox, X } from 'lucide-react';

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean };

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-holo-500 text-ink-950 hover:bg-holo-400 shadow-glow font-semibold',
  ghost: 'border border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.06] hover:text-white',
  danger: 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  subtle: 'text-slate-400 hover:text-white hover:bg-white/5',
};
const SIZES = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = 'ghost', size = 'md', loading, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cn('btn', VARIANTS[variant], SIZES[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------- Card */

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, subtitle, action, icon }: { title: string; subtitle?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="flex items-start gap-3">
        {icon ? <div className="mt-0.5 rounded-lg border border-holo-500/20 bg-holo-500/10 p-2 text-holo-300">{icon}</div> : null}
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; className?: string }) {
  const tones = {
    neutral: 'border-white/10 bg-white/5 text-slate-400',
    good: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    bad: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    accent: 'border-holo-500/30 bg-holo-500/10 text-holo-300',
  };
  return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider', tones[tone], className)}>{children}</span>;
}

/* --------------------------------------------------------------- States */

export function EmptyState({ title, description, icon, action }: { title: string; description: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
      <div className="rounded-full border border-white/10 bg-white/[0.03] p-3 text-slate-500">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <div>
        <p className="text-sm font-medium text-slate-300">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
      <div className="flex-1">
        <p className="text-xs font-medium text-rose-200">Something needs attention</p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-rose-200/70">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-white/[0.05]', className)} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-holo-400" />
      {label ?? 'Loading…'}
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; icon?: React.ReactNode; count?: number }>; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-ink-900/60 p-1', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            value === item.value ? 'bg-holo-500/15 text-holo-200 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.25)]' : 'text-slate-400 hover:text-slate-200',
          )}
        >
          {item.icon}
          {item.label}
          {item.count !== undefined ? <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-slate-400">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Controls */

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4 py-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors', checked ? 'border-holo-400/50 bg-holo-500/40' : 'border-white/10 bg-white/5')}
      >
        <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform', checked ? 'translate-x-[18px] bg-holo-200' : 'translate-x-0.5 bg-slate-400')} />
      </button>
    </label>
  );
}

export function Slider({ value, min, max, step, onChange, label, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-holo-300">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-holo-400"
      />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-300">
        {label}
      </label>
      {children}
      {error ? <p className="text-[11px] text-rose-400">{error}</p> : hint ? <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input appearance-none bg-ink-900 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/* ----------------------------------------------------------------- Modal */

export function Modal({ open, onClose, title, description, children, footer, width = 'md' }: { open: boolean; onClose: () => void; title: string; description?: string; children?: React.ReactNode; footer?: React.ReactNode; width?: 'sm' | 'md' | 'lg' | 'xl' }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('panel relative w-full animate-[float_0s] border-holo-500/15 p-5', widths[width])}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            {description ? <p className="mt-1 text-xs leading-relaxed text-slate-500">{description}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto pr-1">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2 border-t border-white/[0.06] pt-4">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Toast */

export type ToastMessage = { id: string; title: string; description?: string; tone: 'success' | 'error' | 'info' };

export function ToastViewport({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={cn('panel pointer-events-auto flex items-start gap-3 border-l-2 p-3', t.tone === 'success' ? 'border-l-emerald-400' : t.tone === 'error' ? 'border-l-rose-400' : 'border-l-holo-400')}>
          <div className="flex-1">
            <p className="text-xs font-semibold text-slate-100">{t.title}</p>
            {t.description ? <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{t.description}</p> : null}
          </div>
          <button onClick={() => onDismiss(t.id)} className="text-slate-600 hover:text-slate-300" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Progress */

export function ProgressBar({ value, tone = 'accent', className }: { value: number; tone?: 'accent' | 'good' | 'bad' | 'warn'; className?: string }) {
  const tones = { accent: 'bg-holo-400', good: 'bg-emerald-400', bad: 'bg-rose-400', warn: 'bg-amber-400' };
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-white/[0.07]', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', tones[tone])} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon ? <span className="text-slate-600">{icon}</span> : null}
      </div>
      <p className="mt-1.5 text-lg font-semibold text-slate-100">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}
