/** Where toasts are shown: one place, at the top of the tree.
 *
 *  Four decisions, and all four are about the same promise — that a message
 *  raised anywhere is read:
 *
 *  * **The region exists before anything is in it.** `aria-live` is announced
 *    when content is inserted into a region that was already there. A region
 *    that mounts *with* its first toast is silent, which is the single most
 *    common way a toast system is inaccessible while looking completely fine.
 *    So the container is always rendered, and it is empty when nothing is
 *    showing.
 *  * **Routine messages are `status`, failures are `alert`.** The region is
 *    `polite`; a failure inside it carries `role="alert"`, which is assertive on
 *    its own. Everything assertive interrupts, and a queue where "Saved" cuts
 *    off the sentence a screen reader is midway through is a queue that gets
 *    switched off.
 *  * **Nothing is duplicated.** The visible toast *is* the announced one. A
 *    parallel `sr-only` copy is how a toast ends up read twice — and how its
 *    Dismiss button ends up in a subtree marked `aria-hidden`, reachable by
 *    mouse and by nothing else.
 *  * **A toast with a duration dismisses itself; a failure never does.** The
 *    timer lives in the row, keyed by the toast's id, so a toast that is
 *    re-rendered does not get a new timer and one dismissed early does not get a
 *    stale one.
 *
 *  The queue is a prop, not a singleton: `main.tsx` creates it, anything handed
 *  the queue can raise into it, and a test creates its own.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useI18n } from '../core/i18n/context';
import { cx, type ClassValue } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { IconButton } from './IconButton';
import { Portal } from './Portal';
import type { Toast, ToastKind, ToastPlacement, ToastQueue } from './toast';

const ICON: Record<ToastKind, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'alert',
};

const ICON_TONE: Record<ToastKind, string> = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const BORDER_TONE: Record<ToastKind, string> = {
  info: 'border-line',
  success: 'border-line',
  warning: 'border-warning',
  danger: 'border-danger',
};

export interface ToasterProps {
  /** The queue messages are raised into. */
  readonly queue: ToastQueue;
  /** Where the stack sits. Bottom-right by default: the corner that covers the
   *  least, in a window whose bottom-left is a media library and whose
   *  bottom-centre is a timeline. */
  readonly placement?: ToastPlacement;
  readonly className?: ClassValue;
}

const PLACEMENT: Record<NonNullable<ToasterProps['placement']>, string> = {
  'bottom-right': 'bottom-4 right-4 items-end',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center',
  'top-right': 'top-4 right-4 items-end',
};

export function Toaster({
  queue,
  placement = 'bottom-right',
  className,
}: ToasterProps): React.JSX.Element {
  const { t } = useI18n();
  const toasts = useSyncExternalStore(queue.subscribe, queue.current, queue.current);

  return (
    <Portal>
      <div
        // Always in the document, always polite — see the header. A failure is
        // made assertive by its own `role="alert"`, not by moving it to a
        // second region, which would reorder the stack for no reason.
        aria-live="polite"
        aria-atomic="false"
        data-testid="toaster"
        className={cx(
          'pointer-events-none fixed z-[var(--z-toast)] flex flex-col gap-2',
          PLACEMENT[placement],
          className,
        )}
      >
        {toasts.map((toast) => (
          <ToastRow
            key={toast.id}
            toast={toast}
            dismissLabel={t('ui.toast.dismiss')}
            onDismiss={queue.dismiss}
          />
        ))}
      </div>
    </Portal>
  );
}

function ToastRow({
  toast,
  dismissLabel,
  onDismiss,
}: {
  readonly toast: Toast;
  readonly dismissLabel: string;
  readonly onDismiss: (id: string) => void;
}): React.JSX.Element {
  // Read through a ref: a caller who passes an inline arrow must not restart the
  // timer, and a timer restarted on every render is a toast that never expires.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    // Zero means "stay": a failure the user has to be able to finish reading.
    if (toast.durationMs <= 0) return;
    const timer = setTimeout(() => {
      dismiss.current(toast.id);
    }, toast.durationMs);
    return () => {
      clearTimeout(timer);
    };
    // Keyed by the toast, not by the array: a second toast arriving must not
    // restart the first one's countdown.
  }, [toast.durationMs, toast.id]);

  return (
    <div
      // `status` for a routine message, `alert` for a failure — the one
      // difference the region cannot make on its own.
      role={toast.kind === 'danger' ? 'alert' : 'status'}
      className={cx(
        'pointer-events-auto flex w-80 items-start gap-2 rounded-panel border',
        'bg-surface-2 px-3 py-2 shadow-overlay',
        BORDER_TONE[toast.kind],
      )}
    >
      <Icon name={ICON[toast.kind]} size="md" className={cx('mt-0.5', ICON_TONE[toast.kind])} />
      <p className="min-w-0 flex-1 text-sm text-ink">{toast.message}</p>
      {toast.action === undefined ? null : (
        <button
          type="button"
          // The one thing on a toast worth clicking: an action is the reason a
          // toast could not simply have been a status line.
          className="shrink-0 text-sm font-medium text-accent"
          onClick={() => {
            toast.action?.onSelect();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <IconButton
        icon="close"
        label={dismissLabel}
        size="sm"
        onClick={() => {
          onDismiss(toast.id);
        }}
      />
    </div>
  );
}
