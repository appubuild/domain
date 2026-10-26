import type { ReactNode } from "react";
import { cn } from "@/lib/utils/format";

/* ------------------------------------------------------------------------------------
 * Button
 * ---------------------------------------------------------------------------------- */

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none " +
  "transition-[background-color,border-color,color,box-shadow] duration-150 " +
  "disabled:pointer-events-none disabled:opacity-55 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg border border-transparent hover:bg-accent-hover shadow-xs",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface-3 hover:border-border-strong",
  outline:
    "bg-transparent text-fg border border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-fg-muted border border-transparent hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white border border-transparent hover:opacity-90 shadow-xs",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] rounded-sm",
  md: "h-10 px-4 text-sm rounded-[var(--radius)]",
  lg: "h-12 px-6 text-[15px] rounded-lg",
  icon: "h-9 w-9 rounded-[var(--radius)]",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel = "Working…",
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {loading ? <span>{loadingLabel}</span> : children}
    </button>
  );
}

/** Anchor styled as a button — used for real navigations so they stay links. */
export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <a
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    >
      {children}
    </a>
  );
}

/* ------------------------------------------------------------------------------------
 * Feedback atoms
 * ---------------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} aria-hidden="true" />;
}

export type BadgeTone =
  | "neutral"
  | "accent"
  | "violet"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "outline";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  accent: "bg-accent-soft text-accent-soft-fg border-transparent",
  violet: "bg-violet-soft text-violet-soft-fg border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  outline: "bg-transparent text-fg-muted border-border-strong",
};

export function Badge({
  tone = "neutral",
  className,
  children,
  title,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 tracking-wide",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  className,
  icon,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  title?: string;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones = {
    info: "border-info/25 bg-info-soft text-info",
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    success: "border-success/25 bg-success-soft text-success",
  } as const;
  return (
    <div
      role={tone === "danger" ? "alert" : "note"}
      className={cn("flex gap-2.5 rounded-[var(--radius)] border px-3.5 py-3 text-sm", tones[tone], className)}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg-muted [&_a]:underline">{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <div className="space-y-1">
        <p className="font-semibold text-fg">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article" | "li";
}) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-lg)] border border-border bg-surface shadow-xs",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
  headingLevel = 2,
  id,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
  id?: string;
}) {
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="max-w-2xl space-y-2">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
        ) : null}
        <Heading
          id={id}
          className={cn(
            "font-semibold tracking-tight text-fg",
            headingLevel === 1 ? "text-3xl sm:text-4xl" : headingLevel === 2 ? "text-2xl" : "text-lg",
          )}
        >
          {title}
        </Heading>
        {description ? <div className="text-[15px] leading-relaxed text-fg-muted">{description}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "success";
  icon?: ReactNode;
}) {
  const toneClass = {
    neutral: "text-fg",
    accent: "text-accent",
    warn: "text-warn",
    danger: "text-danger",
    success: "text-success",
  }[tone];
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
        {icon ? <span className="text-fg-subtle">{icon}</span> : null}
      </div>
      <p className={cn("tnum mt-1.5 text-2xl font-semibold", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={cn("space-y-1", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label ?? "Progress"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {label ? <p className="text-xs text-fg-muted">{label}</p> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}
