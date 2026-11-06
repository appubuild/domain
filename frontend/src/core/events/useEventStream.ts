/** The socket as a React resource, and as a context like the API client's.
 *
 *  Two rules, both borrowed from `core/api/context.ts` because they are the same
 *  rules: the tree asks for one rather than importing one (a component that
 *  imported a singleton stream could not be rendered in a test), and a missing
 *  provider throws rather than silently doing nothing — a stream that is not
 *  there is a panel that never updates, and "never updates" is the hardest
 *  failure to attribute.
 *
 *  The hook owns the socket's *lifetime*, not its behaviour: it opens on mount,
 *  closes on unmount, and hands the stream to whoever asks. A window that
 *  outlived its socket would otherwise keep a connection the service thinks is
 *  gone, which is a leak on the server and a silent panel on the client.
 */

import { createContext, useContext, useEffect, useMemo, useState, type Context } from 'react';

import { createEventStream, type EventStream, type StreamHealth } from './bridge';
import { eventSocketUrl } from './url';

export interface UseEventStreamOptions {
  /** The origin to open the socket against; empty means this page's origin. */
  readonly origin?: string;
  /** The session token, when the window was handed one. */
  readonly token?: string | undefined;
  /** Called when the bus could not repair a gap: refetch the state you hold. */
  readonly onStale?: (reason: string) => void;
  readonly onError?: (error: unknown) => void;
}

export interface EventStreamHandle {
  readonly stream: EventStream;
  readonly health: StreamHealth;
}

/** The stream this tree was given, or nothing. */
export const EventStreamContext: Context<EventStream | undefined> = createContext<
  EventStream | undefined
>(undefined);

export function useEventStreamContext(): EventStream {
  const stream = useContext(EventStreamContext);
  if (!stream) {
    throw new Error('no EventStream in context — wrap this tree in <EventStreamContext.Provider>');
  }
  return stream;
}

/** Open one socket for as long as this component is mounted.
 *
 *  The stream is created once per mount and never recreated on a re-render: a
 *  new socket on every render is a reconnect loop that only shows up under load,
 *  where it looks like the service flaking.
 */
export function useEventStream(options: UseEventStreamOptions = {}): EventStreamHandle {
  const [health, setHealth] = useState<StreamHealth>({
    status: 'idle',
    lastSeq: 0,
    dropped: 0,
    attempts: 0,
  });

  const stream = useMemo(() => {
    const url = eventSocketUrl(options.origin ?? '', options.token);
    return createEventStream({
      url,
      socketFactory: (target) => new WebSocket(target),
      onHealth: setHealth,
      ...(options.onStale ? { onStale: options.onStale } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    // Created once: the socket outlives re-renders, and its dependencies are
    // the ones it was constructed with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stream.open();
    return () => {
      stream.close();
    };
  }, [stream]);

  return { stream, health };
}
