import * as React from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ button */

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success' | 'link' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'xs';

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-soft',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  outline: 'border border-input bg-card hover:bg-muted text-foreground',
  ghost: 'hover:bg-muted text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  success: 'bg-success text-success-foreground hover:bg-success/90',
  link: 'text-primary underline-offset-4 hover:underline',
  accent: 'bg-accent text-accent-foreground hover:bg-accent/90',
};

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-6 text-sm gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

/* ------------------------------------------------------------------- input */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1.5 text-sm shadow-soft transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-soft transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, children, ...props }, ref) => (
    <label ref={ref} className={cn('mb-1.5 block text-sm font-medium text-foreground', className)} {...props}>
      {children}
    </label>
  ),
);
Label.displayName = 'Label';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: { value: string; label: string }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full appearance-none rounded-lg border border-input bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat px-3 py-1.5 pr-8 text-sm shadow-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: string;
  /** Convenience handler mirroring the shadcn-style API used across the app. */
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({ className, label, description, id, onCheckedChange, onChange, ...props }: CheckboxProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={inputId}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-input text-primary accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...props}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.target.checked);
        }}
      />
      {(label || description) && (
        <div className="leading-tight">
          {label && (
            <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-foreground">
              {label}
            </label>
          )}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn('pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  format,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  format?: (value: number) => string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="tabular-nums text-muted-foreground">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-[hsl(var(--primary))] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- surfaces */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-card shadow-soft', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 border-b border-border px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold leading-tight text-foreground', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2 border-t border-border px-5 py-3', className)} {...props} />;
}

export function Separator({ className, orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  return <div role="separator" className={cn('bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)} />;
}

/* ------------------------------------------------------------------ badges */

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-muted text-muted-foreground border-border',
  outline: 'border-border text-foreground',
  success: 'bg-success/10 text-success border-success/25',
  warning: 'bg-warning/15 text-warning-foreground border-warning/30 dark:text-warning',
  danger: 'bg-destructive/10 text-destructive border-destructive/25',
  info: 'bg-info/10 text-info border-info/25',
  accent: 'bg-accent/15 text-accent-foreground border-accent/30 dark:text-accent',
};

export function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4 tracking-wide',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({
  name,
  src,
  size = 36,
  className,
  ring,
}: {
  name: string;
  src?: string;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const colors = ['bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500'];
  const color = colors[(name.charCodeAt(0) + name.length) % colors.length];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white',
        ring && 'ring-2 ring-card',
        !src && color,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden={false}
      role="img"
      aria-label={name}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <span className="font-semibold">{initials}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- progress */

export function Progress({ value, className, indicatorClassName }: { value: number; className?: string; indicatorClassName?: string }) {
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full bg-primary transition-[width] duration-500', indicatorClassName)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

/* ---------------------------------------------------------------- tooltip */

export function Tooltip({
  content,
  children,
  side = 'top',
  shortcut,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  shortcut?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-50 flex animate-fade-in items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-2xs font-medium text-background shadow-lift',
            positions[side],
          )}
        >
          {content}
          {shortcut && <kbd className="rounded border border-background/30 px-1 text-[10px] opacity-80">{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------- misc */

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{children}</kbd>
  );
}

export function Tag({ children, onRemove, className }: { children: React.ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground', className)}>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-muted-foreground hover:text-foreground" aria-label={`Remove ${String(children)}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function Rating({ value, count, size = 14, className }: { value: number; count?: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="flex" aria-label={`${value.toFixed(1)} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <svg key={star} width={size} height={size} viewBox="0 0 24 24" aria-hidden className={star <= Math.round(value) ? 'text-amber-400' : 'text-muted-foreground/30'}>
            <path
              fill="currentColor"
              d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.6 6 20.8l1.3-6.7-5-4.6 6.8-.8z"
            />
          </svg>
        ))}
      </span>
      <span className="text-xs font-medium text-muted-foreground">
        {value.toFixed(1)}
        {count !== undefined && ` (${count})`}
      </span>
    </span>
  );
}

export function AspectImage({
  src,
  alt,
  className,
  ratio = '2 / 3',
}: {
  src?: string;
  alt: string;
  className?: string;
  ratio?: string;
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-md bg-muted', className)} style={{ aspectRatio: ratio }}>
      {src ? <img src={src} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

export { buttonVariants, badgeVariants };
