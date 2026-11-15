/** The transport, once.
 *
 *  `useTransport` starts a clock. A clock is a **window-level** thing: there is
 *  one playhead, and when it moves it moves for the preview, the timeline and
 *  the command palette at the same moment. Three components each calling
 *  `useTransport` gave the window three clocks, and three clocks is a bug that
 *  hides until the user presses play in a pane: each clock counts from the frame
 *  *it* last saw playback start at, so the one that did not see it keeps writing
 *  the frame it thinks is right, and the playhead fights itself.
 *
 *  So the hook is called here, once, and everything else reads the answer:
 *
 *      <TransportProvider>          ← one clock, owned by the window
 *        <PreviewPane />            ← useTransportContext()
 *        <TimelinePanel />          ← useTransportContext()
 *
 *  A pane that reads the context cannot start a second clock by accident, and a
 *  pane tested on its own is given the provider by its test — which is the same
 *  arrangement the stores already use.
 */

import type { ReactNode } from 'react';

import { useTimebase } from '../../stores/timeline';
import { TransportContext } from './transport-context';
import { useTransport } from './useTransport';

export interface TransportProviderProps {
  readonly children: ReactNode;
}

/** The transport for this window. Mounted by `WorkspaceProviders`, inside the
 *  playback and timeline stores it reads. */
export function TransportProvider({ children }: TransportProviderProps): React.JSX.Element {
  const timebase = useTimebase();
  const transport = useTransport(timebase);
  // `useTransport` returns a memoized object, so the context value is stable
  // and a pane does not re-render because the clock ticked.
  return <TransportContext.Provider value={transport}>{children}</TransportContext.Provider>;
}
