import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastContextValue {
  toast: (input: Omit<Toast, 'id' | 'duration' | 'variant'> & { variant?: ToastVariant; duration?: number }) => string;
  success: (title: string, description?: string, action?: Toast['action']) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { ring: string; icon: React.ReactNode }> = {
  default: { ring: 'border-border', icon: '•' },
  success: { ring: 'border-success/40', icon: '✓' },
  error: { ring: 'border-destructive/40', icon: '!' },
  warning: { ring: 'border-warning/50', icon: '!' },
  info: { ring: 'border-info/40', icon: 'i' },
};

const ICON_STYLES: Record<ToastVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  error: 'bg-destructive/15 text-destructive',
  warning: 'bg-warning/20 text-warning-foreground dark:text-warning',
  info: 'bg-info/15 text-info',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    ({ variant = 'default', duration = 4200, ...rest }) => {
      const id = `toast_${Math.random().toString(36).slice(2, 9)}`;
      setToasts((current) => [...current.slice(-3), { id, variant, duration, ...rest }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description, action) => toast({ title, description, variant: 'success', action }),
      error: (title, description) => toast({ title, description, variant: 'error', duration: 6000 }),
      info: (title, description) => toast({ title, description, variant: 'info' }),
      warning: (title, description) => toast({ title, description, variant: 'warning', duration: 6000 }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2" role="region" aria-label="Notifications">
            {toasts.map((entry) => (
              <div
                key={entry.id}
                role="status"
                className={cn(
                  'pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border bg-card/95 p-3.5 shadow-lift backdrop-blur',
                  VARIANT_STYLES[entry.variant].ring,
                )}
              >
                <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold', ICON_STYLES[entry.variant])}>
                  {VARIANT_STYLES[entry.variant].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{entry.title}</p>
                  {entry.description && <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>}
                  {entry.action && (
                    <button
                      type="button"
                      onClick={() => {
                        entry.action?.onClick();
                        dismiss(entry.id);
                      }}
                      className="mt-1.5 text-xs font-semibold text-primary hover:underline"
                    >
                      {entry.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(entry.id)}
                  aria-label="Dismiss notification"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
