/** The window's providers: what a panel can ask for, and who owns its lifetime.
 *
 *  Four things are composed here, and the order is the point:
 *
 *  1. the **API client** — bound once in `main.tsx`, because only that file
 *     knows how this window was delivered;
 *  2. the **event stream** — one socket for the window;
 *  3. the **project store** — built around the client, never around a global;
 *  4. the **wiring between them** — `project.*` events go to the store, and a
 *     gap the bus could not repair makes the store ask again.
 *
 *  The wiring lives here rather than inside either half, because neither should
 *  know about the other: a store that subscribed to a socket could not be built
 *  in a test, and a stream that wrote to a store could not be pointed at
 *  another one.
 *
 *  One refresh happens on mount, before any event arrives — a service that has
 *  been up for an hour has no event to tell us what it is already holding.
 *
 *  The seam is the **socket factory**: everything above it is what a panel
 *  asks for, and swapping it is how this tree is rendered without a service.
 */

import { useEffect, useMemo, type ReactNode } from 'react';

import type { ApiClient } from '../core/api/client';
import type { SocketLike } from '../core/events/bridge';
import { EventStreamContext, useEventStream } from '../core/events/useEventStream';
import { createProjectStore, ProjectStoreContext } from '../stores/project';

export interface WorkspaceProvidersProps {
  readonly client: ApiClient;
  /** Injected so a test can render the whole tree without a service. */
  readonly socketFactory?: (url: string) => SocketLike;
  /** Where the socket is opened; empty means this page's own origin. */
  readonly origin?: string;
  /** The session token, when this window was handed one. */
  readonly token?: string | undefined;
  readonly children: ReactNode;
}

export function WorkspaceProviders({
  client,
  socketFactory,
  origin,
  token,
  children,
}: WorkspaceProvidersProps): React.JSX.Element {
  // One store per client, and not per render: a store rebuilt on every render
  // is a store that forgets everything sixty times a second.
  const store = useMemo(() => createProjectStore(client), [client]);

  const { stream } = useEventStream({
    ...(origin ? { origin } : {}),
    ...(token ? { token } : {}),
    ...(socketFactory ? { socketFactory } : {}),
    onStale: () => {
      // A hole the bus could not repair: the stream is the thing that notices,
      // and the store is the thing that knows what to ask for again.
      void store.getState().refresh();
    },
  });

  useEffect(() => {
    void store.getState().refresh();
    // `project.*` and not the whole stream: a store that reacted to every topic
    // would refetch on every frame of a scrub.
    return stream.subscribe('project.*', store.getState().applyEvent);
  }, [store, stream]);

  return (
    <EventStreamContext.Provider value={stream}>
      <ProjectStoreContext.Provider value={store}>{children}</ProjectStoreContext.Provider>
    </EventStreamContext.Provider>
  );
}
