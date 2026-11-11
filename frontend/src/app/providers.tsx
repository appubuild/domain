/** The window's providers: what a panel can ask for, and who owns its lifetime.
 *
 *  Five things are composed here, and the order is the point:
 *
 *  1. the **API client** — bound once in `main.tsx`, because only that file
 *     knows how this window was delivered;
 *  2. the **event stream** — one socket for the window;
 *  3. the **stores** — the project slice, then the three that describe the
 *     project being edited: its media, its edit, and where the playhead is.
 *     Each is built around the client, never around a global;
 *  4. the **wiring between them** — `project.*` events go to the project store,
 *     `media.*` to the media store, `command.*` to the timeline store, and a gap
 *     the bus could not repair makes all of them ask again.
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
import { createMediaStore, MediaStoreContext } from '../stores/media';
import { createPlaybackStore, PlaybackStoreContext } from '../stores/playback';
import { createProjectStore, ProjectStoreContext } from '../stores/project';
import { createTimelineStore, TimelineStoreContext } from '../stores/timeline';

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
  const media = useMemo(() => createMediaStore(client), [client]);
  const timeline = useMemo(() => createTimelineStore(client), [client]);
  const playback = useMemo(() => createPlaybackStore(), []);

  const { stream } = useEventStream({
    ...(origin ? { origin } : {}),
    ...(token ? { token } : {}),
    ...(socketFactory ? { socketFactory } : {}),
    onStale: () => {
      // A hole the bus could not repair: the stream is the thing that notices,
      // and the stores are the things that know what to ask for again.
      void store.getState().refresh();
      void media.getState().refresh();
      void timeline.getState().refresh();
    },
  });

  useEffect(() => {
    void store.getState().refresh();
    // `project.*` and not the whole stream: a store that reacted to every topic
    // would refetch on every frame of a scrub.
    const offProject = stream.subscribe('project.*', store.getState().applyEvent);
    const offMedia = stream.subscribe('media.*', media.getState().applyEvent);
    const offAsset = stream.subscribe('asset.*', media.getState().applyEvent);
    const offCommand = stream.subscribe('command.*', timeline.getState().applyEvent);
    return () => {
      offProject();
      offMedia();
      offAsset();
      offCommand();
    };
  }, [media, store, stream, timeline]);

  return (
    <EventStreamContext.Provider value={stream}>
      <ProjectStoreContext.Provider value={store}>
        <MediaStoreContext.Provider value={media}>
          <TimelineStoreContext.Provider value={timeline}>
            <PlaybackStoreContext.Provider value={playback}>
              {children}
            </PlaybackStoreContext.Provider>
          </TimelineStoreContext.Provider>
        </MediaStoreContext.Provider>
      </ProjectStoreContext.Provider>
    </EventStreamContext.Provider>
  );
}
