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
 *  outlived its socket would keep a connection the service thinks is gone,
 *  which is a leak on the server and a silent panel on the client.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Context,
} from 'react';

import { createEventStream, type EventStream, type SocketLike, type StreamHealth } from './bridge';
import { eventSocketUrl } from './url';

/** What the service refused to repair: refetch the state you hold. */
export type StaleHandler = (reason: string) => void;

export interface UseEventStreamOptions {
  /** The origin to open the socket against; empty means this page's origin. */
  readonly origin?: string;
  /** The session token, when the window was handed one. */
  readonly token?: string | undefined;
  /** Called when the bus could not repair a gap. */
  readonly onStale?: StaleHandler;
  readonly onError?: (error: unknown) => void;
  /** Injected so a test can render a tree that needs a socket. */
  readonly socketFactory?: (url: string) => SocketLike;
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

/** The health of the stream above this component, kept current.
 *
 *  This is how a status line in a panel learns the socket dropped without being
 *  handed the socket. It reads the *stable* stream out of context and subscribes
 *  to its health, so a component that only wants to show a dot does not hold the
 *  connection open.
 */
export function useStreamHealth(): StreamHealth {
  const stream = useEventStreamContext();
  const subscribe = useCallback(
    (onChange: () => void) =>
      stream.onHealthChange(() => {
        onChange();
      }),
    [stream],
  );
  const snapshot = useCallback(() => stream.health(), [stream]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Open one socket for as long as this component is mounted.
 *
 *  The stream is created once and never rebuilt under a re-render: a new socket
 *  per render is a reconnect loop that only shows up under load, where it looks
 *  like the service flaking. The callbacks are read through a ref rather than
 *  captured, so a caller may pass an inline arrow — the stream stays the same
 *  one while the handler stays current.
 */
export function useEventStream(options: UseEventStreamOptions = {}): EventStreamHandle {
  const [health, setHealth] = useState<StreamHealth>({
    status: 'idle',
    lastSeq: 0,
    dropped: 0,
    attempts: 0,
  });

  const latest = useRef<{
    onStale: StaleHandler | undefined;
    onError: ((error: unknown) => void) | undefined;
    socketFactory: ((url: string) => SocketLike) | undefined;
  }>({ onStale: undefined, onError: undefined, socketFactory: undefined });
  latest.current = {
    onStale: options.onStale,
    onError: options.onError,
    socketFactory: options.socketFactory,
  };

  const origin = options.origin ?? '';
  const token = options.token;

  // Stable, and deliberately so: a factory passed as an inline arrow — which is
  // the natural way to write it — must not rebuild the stream on every render,
  // because a rebuilt stream is a reconnected socket.
  const openSocket = useCallback(
    (url: string): SocketLike =>
      (latest.current.socketFactory ?? ((target: string) => new WebSocket(target)))(url),
    [],
  );

  const stream = useMemo(
    () =>
      createEventStream({
        url: eventSocketUrl(origin, token),
        socketFactory: openSocket,
        onHealth: setHealth,
        onStale: (reason: string) => latest.current.onStale?.(reason),
        onError: (error: unknown) => latest.current.onError?.(error),
      }),
    [origin, token, openSocket],
  );

  useEffect(() => {
    stream.open();
    return () => {
      stream.close();
    };
  }, [stream]);

  return { stream, health };
}
