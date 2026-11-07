import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Loader2, Search, X } from 'lucide-react'

export const cn = (...values: Array<string | false | null | undefined>): string =>
  values.filter(Boolean).join(' ')

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                   */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 focus-visible:ring-brand-500 disabled:bg-brand-600/60',
  secondary:
    'border border-line bg-surface text-ink shadow-sm hover:bg-soft focus-visible:ring-brand-500',
  ghost: 'text-muted hover:bg-soft hover:text-ink focus-visible:ring-brand-500',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-500',
  subtle: 'bg-soft text-ink hover:bg-navy-100 dark:hover:bg-navy-800 focus-visible:ring-brand-500',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, iconLeft, iconRight, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : iconLeft}
      {children}
      {iconRight}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'default' | 'danger'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tone = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        tone === 'danger'
          ? 'text-rose-600 hover:border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40'
          : 'text-muted hover:bg-soft hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

/* -------------------------------------------------------------------------- */
/*  Form controls                                                             */
/* -------------------------------------------------------------------------- */

const CONTROL_BASE =
  'w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-sm transition placeholder:text-muted/70 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-soft'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL_BASE, 'h-10', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(CONTROL_BASE, 'py-2.5 leading-relaxed', className)} {...rest} />
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL_BASE, 'h-10 cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  )
})

export interface FieldProps {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export const Field = ({ label, htmlFor, hint, error, required, children, className }: FieldProps) => (
  <div className={cn('space-y-1.5', className)}>
    <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-semibold text-ink">
      {label}
      {required ? <span className="text-rose-500">*</span> : null}
    </label>
    {children}
    {error ? (
      <p className="text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>
    ) : hint ? (
      <p className="text-xs text-muted">{hint}</p>
    ) : null}
  </div>
)

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}

export const Switch = ({ checked, onChange, label, description, disabled }: SwitchProps) => {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-navy-200 dark:bg-navy-700',
        )}
      >
        <span
          className={cn(
            'inline-block transform rounded-full bg-white shadow transition',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
          style={{ height: '1.125rem', width: '1.125rem' }}
        />
      </button>
    </div>
  )
}

export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void
}

export const SearchInput = ({ className, onClear, value, ...rest }: SearchInputProps) => (
  <div className={cn('relative', className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
    <input
      type="search"
      value={value}
      className={cn(CONTROL_BASE, 'h-10 pl-9 pr-9')}
      {...rest}
    />
    {value && onClear ? (
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear search"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition hover:bg-soft hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    ) : null}
  </div>
)

/* -------------------------------------------------------------------------- */
/*  Surfaces                                                                  */
/* -------------------------------------------------------------------------- */

export const Card = ({ className, children }: { className?: string; children?: ReactNode }) => (
  <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)}>{children}</div>
)

export const CardHeader = ({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
    <div className="min-w-0">
      <h2 className="font-display text-base font-bold text-ink">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
    </div>
    {action}
  </div>
)

export const PageHeader = ({
  title,
  description,
  actions,
  meta,
}: {
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
      {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      {meta ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">{meta}</div> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
)

export type BadgeTone = 'brand' | 'success' | 'amber' | 'rose' | 'slate' | 'violet'

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950/50 dark:text-brand-200 dark:ring-brand-900',
  success:
    'bg-success-50 text-success-700 ring-success-300/60 dark:bg-success-700/15 dark:text-success-300 dark:ring-success-700/40',
  amber: 'bg-amber-50 text-amber-700 ring-amber-300/60 dark:bg-amber-600/15 dark:text-amber-300 dark:ring-amber-700/40',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900',
  slate: 'bg-soft text-muted ring-line',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900',
}

export const Badge = ({
  tone = 'slate',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide ring-1 ring-inset',
      BADGE_TONES[tone],
      className,
    )}
  >
    {children}
  </span>
)

export const EmptyState = ({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    {icon ? <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-soft text-muted">{icon}</div> : null}
    <p className="font-display text-sm font-bold text-ink">{title}</p>
    {description ? <p className="max-w-sm text-xs text-muted">{description}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
)

/* -------------------------------------------------------------------------- */
/*  Segmented control / tabs                                                  */
/* -------------------------------------------------------------------------- */

export interface SegmentOption<T extends string | number> {
  value: T
  label: string
}

export const Segmented = <T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  ariaLabel: string
}) => (
  <div
    role="tablist"
    aria-label={ariaLabel}
    className={cn(
      'inline-flex items-center gap-1 rounded-xl border border-line bg-soft p-1',
      size === 'sm' ? 'text-2xs' : 'text-xs',
    )}
  >
    {options.map((option) => {
      const active = option.value === value
      return (
        <button
          key={String(option.value)}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-lg font-semibold transition',
            size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5',
            active ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      )
    })}
  </div>
)

/* -------------------------------------------------------------------------- */
/*  Modal + confirm dialog                                                    */
/* -------------------------------------------------------------------------- */

export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) => {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, button')
        ?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      clearTimeout(timer)
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-navy-950/60 backdrop-blur-sm animate-fade-in"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 w-full rounded-t-2xl border border-line bg-surface shadow-float animate-scale-in sm:rounded-2xl',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          <IconButton label="Close" onClick={onClose} className="shrink-0 border-transparent bg-transparent">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-soft/60 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) => (
  <Modal
    open={open}
    onClose={onCancel}
    title={title}
    size="sm"
    footer={
      <>
        <Button variant="secondary" onClick={onCancel} size="sm">
          {cancelLabel}
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} size="sm">
          {confirmLabel}
        </Button>
      </>
    }
  >
    <div className="flex items-start gap-3">
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          tone === 'danger' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-brand-50 text-brand-600',
        )}
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="pt-1 text-sm text-muted">{description}</p>
    </div>
  </Modal>
)

/* -------------------------------------------------------------------------- */
/*  Misc                                                                      */
/* -------------------------------------------------------------------------- */

export const Avatar = ({ initials, className }: { initials: string; className?: string }) => (
  <span
    className={cn(
      'inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white ring-2 ring-white/20',
      className,
    )}
  >
    {initials}
  </span>
)

export const SimulatedBadge = () => (
  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-2xs font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-600/15 dark:text-amber-300 dark:ring-amber-700/40">
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
    </span>
    Simulated data
  </span>
)

export const Divider = ({ className }: { className?: string }) => (
  <div className={cn('h-px w-full bg-line', className)} />
)
