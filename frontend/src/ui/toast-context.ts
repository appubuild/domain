/** The queue this tree raises messages into.
 *
 *  Split out of `Toaster.tsx` for one reason: a module that exports a component
 *  and something else breaks fast refresh, and — more to the point — the queue
 *  is not part of the *view* of a message. The view is `Toaster`; this is the
 *  seam a component reaches through, and it is the same seam `core/api/context`
 *  is for the client.
 */

import { createContext, useContext } from 'react';

import type { ToastQueue } from './toast';

export const ToastContext = createContext<ToastQueue | undefined>(undefined);

/** The queue for this tree.
 *
 *  Throws when there is none, like `useApi`: a component that raised a toast
 *  into a queue that was never provided has not failed visibly, and a message
 *  nobody saw is worse than an exception nobody expected.
 *
 *  What comes back is the *store*, not a `push` function — so a callback that
 *  runs after its component has unmounted, which is when "export finished"
 *  happens, still works.
 */
export function useToastQueue(): ToastQueue {
  const queue = useContext(ToastContext);
  if (queue === undefined) {
    throw new Error('no ToastQueue in context — wrap this tree in <ToastProvider>');
  }
  return queue;
}
