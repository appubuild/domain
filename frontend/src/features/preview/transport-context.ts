/** The transport's context: what a pane asks for, and nothing else.
 *
 *  Split from `TransportProvider.tsx` for the reason the theme's is: a module
 *  that exports a component *and* other things breaks fast refresh, and a hook
 *  that lived next to JSX would be imported by every pane in the app for the
 *  sake of a symbol it could get from here.
 */

import { createContext, useContext, type Context } from 'react';

import type { Transport } from './useTransport';

export const TransportContext: Context<Transport | undefined> = createContext<
  Transport | undefined
>(undefined);

/** The window's transport: one playhead, one clock.
 *
 *  Throws when there is none, like every other context in the app: a pane that
 *  quietly made its own transport would be a pane that quietly started a second
 *  clock, which is the bug the provider exists to prevent.
 */
export function useTransportContext(): Transport {
  const transport = useContext(TransportContext);
  if (!transport) {
    throw new Error('no transport in context — wrap this tree in <TransportProvider>');
  }
  return transport;
}
