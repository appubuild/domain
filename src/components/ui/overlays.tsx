import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from './primitives';

/* ------------------------------------------------------------------ dialog */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  labelledBy?: string;
}

export function Dialog({ open, onOpenChange, children, className, size = 'md', labelledBy }: DialogProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
      if (event.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      const autofocus = ref.current?.querySelector<HTMLElement>('[data-autofocus]');
      (autofocus ?? ref.current)?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[95vw] h-[92vh]',
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/60 backdrop-blur-sm" onClick={() => onOpenChange(false)} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lift outline-none animate-scale-in',
          sizes[size],
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>{children}</div>;
}

export function DialogTitle({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <h2 id={id} className={cn('text-base font-semibold text-foreground', className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)}>{children}</p>;
}

export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-4 scrollbar-thin', className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3', className)}>{children}</div>;
}

export function DialogClose({ onClose, label = 'Close' }: { onClose: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------- confirm dialog */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  requireText?: string;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = React.createContext<ConfirmContextValue>({ confirm: async () => false });

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null);
  const [typed, setTyped] = React.useState('');

  const confirm = React.useCallback(
    (options: ConfirmOptions) => {
      setTyped('');
      return new Promise<boolean>((resolve) => setState({ options, resolve }));
    },
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog open={Boolean(state)} onOpenChange={(open) => !open && close(false)} size="sm">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle>{state.options.title}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {state.options.description && <p className="text-sm text-muted-foreground">{state.options.description}</p>}
              {state.options.requireText && (
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground">
                    Type <strong className="text-foreground">{state.options.requireText}</strong> to confirm
                  </label>
                  <input
                    data-autofocus
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    className="mt-1 flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                {state.options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={state.options.destructive ? 'destructive' : 'default'}
                disabled={Boolean(state.options.requireText) && typed !== state.options.requireText}
                onClick={() => close(true)}
              >
                {state.options.confirmLabel ?? 'Confirm'}
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return React.useContext(ConfirmContext).confirm;
}

/* -------------------------------------------------------------------- sheet */

export function Sheet({
  open,
  onOpenChange,
  children,
  side = 'right',
  size = 'md',
  labelledBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  side?: 'left' | 'right' | 'bottom';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  labelledBy?: string;
}) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onOpenChange(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  const positions = {
    right: `inset-y-0 right-0 h-full w-full ${widths[size]}`,
    left: `inset-y-0 left-0 h-full w-full ${widths[size]}`,
    bottom: 'inset-x-0 bottom-0 w-full max-h-[88vh] rounded-t-2xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm" onClick={() => onOpenChange(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          'absolute flex flex-col border-border bg-card shadow-lift',
          positions[side],
          side === 'bottom' ? 'border-t' : side === 'right' ? 'border-l' : 'border-r',
          side === 'bottom' ? 'animate-fade-up' : side === 'right' ? 'animate-slide-in-right' : 'animate-fade-in',
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------ dropdown menu */

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
  divider?: boolean;
  checked?: boolean;
  hint?: string;
}

export function DropdownMenu({
  trigger,
  items,
  align = 'end',
  className,
}: {
  trigger: React.ReactElement;
  items: MenuItemDef[];
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      {React.cloneElement(trigger, {
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      } as React.HTMLAttributes<HTMLElement>)}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-[calc(100%+6px)] z-50 min-w-[200px] animate-scale-in overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lift',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {items.map((item, index) =>
            item.divider ? (
              <div key={`divider-${index}`} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-40',
                  item.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-muted',
                )}
              >
                {item.checked !== undefined && (
                  <span className={cn('w-3 text-xs', item.checked ? 'text-primary' : 'opacity-0')}>✓</span>
                )}
                {item.icon && <span className="shrink-0 text-muted-foreground">{item.icon}</span>}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="text-2xs text-muted-foreground">{item.hint}</span>}
                {item.shortcut && <kbd className="font-mono text-[10px] text-muted-foreground">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ popover */

export function Popover({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: React.ReactElement;
  children: React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      {React.cloneElement(trigger, {
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        'aria-expanded': open,
      } as React.HTMLAttributes<HTMLElement>)}
      {open && (
        <div
          className={cn(
            'absolute top-[calc(100%+8px)] z-50 animate-scale-in rounded-lg border border-border bg-popover shadow-lift',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onValueChange,
  className,
  size = 'md',
}: {
  tabs: { value: string; label: string; count?: number; icon?: React.ReactNode }[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" className={cn('inline-flex items-center gap-1 rounded-lg bg-muted p-1', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          onClick={() => onValueChange(tab.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === tab.value ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', value === tab.value ? 'bg-primary/10 text-primary' : 'bg-background/60 text-muted-foreground')}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------- composed modal dialog */

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: DialogProps['size'];
  className?: string;
}

/**
 * Convenience wrapper around the dialog primitives for the common
 * title + body + footer shape used throughout the app.
 */
export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md', className }: ModalProps) {
  const titleId = React.useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size={size} labelledBy={titleId} className={className}>
      <DialogHeader>
        <div className="min-w-0">
          <DialogTitle id={titleId}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </div>
        <DialogClose onClose={() => onOpenChange(false)} />
      </DialogHeader>
      <DialogBody>{children}</DialogBody>
      {footer && <DialogFooter>{footer}</DialogFooter>}
    </Dialog>
  );
}
