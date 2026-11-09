/** The queue for this tree, and the place the messages are shown.
 *
 *  One component for both, because they are one decision: whoever owns the
 *  queue is the component that must be mounted for a message to be seen, and an
 *  app that could hold a queue with nowhere to show it would be an app that can
 *  raise a message into nowhere.
 */

import { type ReactNode, useMemo } from 'react';

import { ToastContext } from './toast-context';
import { createToastQueue, type ToastPlacement, type ToastQueue } from './toast';
import { Toaster } from './Toaster';

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** The queue to use. One is made when none is given, which is what a window
   *  wants and what a test does not: a test makes its own, so two tests cannot
   *  see each other's toasts. */
  readonly queue?: ToastQueue | undefined;
  /** Where the messages stack. Bottom-right by default. */
  readonly placement?: ToastPlacement;
}

export function ToastProvider({
  children,
  queue,
  placement,
}: ToastProviderProps): React.JSX.Element {
  const owned = useMemo(() => queue ?? createToastQueue(), [queue]);
  return (
    <ToastContext.Provider value={owned}>
      {children}
      <Toaster queue={owned} {...(placement ? { placement } : {})} />
    </ToastContext.Provider>
  );
}
