/** The WebSocket bridge: one socket, sequence-checked, self-repairing.
 *
 *  Three decisions carry the weight, and all three are the backend's rules
 *  honoured on this side of the wire (`api.md` §6):
 *
 *  * **Every frame is sequence-checked.** A client that sees `…41, 42, 47`
 *    knows it lost four events and *which* four, so recovery is a request
 *    (`resync {since}`) rather than a guess. The gap has to be detected here
 *    because nothing downstream can: a store sees a stream, not a sequence.
 *  * **A gap is repaired from history, or admitted.** When `resync` answers
 *    `complete: false`, the bridge does not pretend: it calls `onStale`, and the
 *    store refetches. A partial replay presented as complete is a UI showing a
 *    state that never existed.
 *  * **The socket is a notification channel, not a data pipe.** Handlers get
 *    small envelopes. Anything large comes over REST.
 *
 *  Two more that are this file's own:
 *
 *  * **A handler that throws does not take the socket with it.** One panel's bug
 *    is not an editor-wide event outage; the error is reported and the stream
 *    continues.
 *  * **Reconnection backs off.** A service that is restarting gets a window to
 *    finish, not a tight loop. The delay doubles with jitter and resets the
 *    moment a `hello` arrives, so a healthy session is never penalised for a
 *    hiccup three hours ago.
 *
 *  What is deliberately not here: a topic subscription sent to the server. The
 *  backend decides what a socket carries; this bridge filters locally, because a
 *  client that could ask for fewer topics could also ask for the wrong ones.
 */

import { encodeFrame, parseFrame, type EventEnvelope, type ServerFrame } from './protocol';

/** Where the socket is in its life, which is what a status line shows. */
export type StreamStatus =
  /** Never connected, or closed on purpose. */
  | 'idle'
  /** Opening, or waiting to retry. */
  | 'connecting'
  /** A `hello` has arrived; frames are flowing. */
  | 'live'
  /** The socket dropped and a retry is scheduled. */
  | 'reconnecting';

export interface StreamHealth {
  readonly status: StreamStatus;
  /** Newest sequence we have applied; 0 before the first event. */
  readonly lastSeq: number;
  /** Events the bus dropped for us because we fell behind — a number, not a mystery. */
  readonly dropped: number;
  /** Consecutive reconnects; 0 while healthy. */
  readonly attempts: number;
}

export interface EventHandler {
  (envelope: EventEnvelope): void;
}

/** A topic, or a prefix: `timeline.clip.moved` matches exactly, `timeline.*`
 *  matches everything under `timeline.`, and `*` matches everything. */
export type TopicPattern = string;

/** Told when the stream's health changes. */
export type HealthListener = (health: StreamHealth) => void;

export interface EventStreamOptions {
  /** Open a socket. Injected, because a test cannot open a real one and a
   *  browser cannot open one to a loopback service that is not running. */
  readonly socketFactory: (url: string) => SocketLike;
  readonly url: string;
  /** Called when a gap predates the bus's history: refetch over REST. */
  readonly onStale?: (reason: string) => void;
  /** Called when a handler throws. Never called for a transport problem. */
  readonly onError?: (error: unknown) => void;
  readonly onHealth?: (health: StreamHealth) => void;
  /** First retry delay; doubled with jitter up to `maxRetryMs`. */
  readonly retryMs?: number;
  readonly maxRetryMs?: number;
  /** Frames of silence before the socket is presumed dead. Multiplied by the
   *  heartbeat interval the server announced. */
  readonly silenceTolerance?: number;
  /** Injected so a test does not wait for real time to pass. */
  readonly now?: () => number;
  readonly setTimeout?: (fn: () => void, ms: number) => number;
  readonly clearTimeout?: (handle: number) => void;
}

/** The slice of `WebSocket` this bridge uses, and no more.
 *
 *  The handler signatures are the DOM's own rather than a simplification, so a
 *  real `WebSocket` satisfies this without an adapter — an adapter would be one
 *  more place for a handler to be wired to the wrong event.
 */
export interface SocketLike {
  readonly readyState?: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface EventStream {
  /** Register a handler. Returns the unsubscribe. */
  readonly subscribe: (pattern: TopicPattern, handler: EventHandler) => () => void;
  /** The socket's health, as of now.
   *
   *  The object is the *same* one between changes, which is what lets React
   *  compare it cheaply: a snapshot rebuilt on every call would re-render a
   *  status line on every frame of a scrub. */
  readonly health: () => StreamHealth;
  /** Watch the health. Returns the unsubscribe.
   *
   *  Many listeners rather than the one `onHealth` option, because more than
   *  one thing wants to know: a status line in the shell, a retry notice in a
   *  panel. A single slot would let the last one to register silence the rest. */
  readonly onHealthChange: (listener: HealthListener) => () => void;
  /** Open the socket. Idempotent: calling it on a live stream does nothing. */
  readonly open: () => void;
  /** Say goodbye and stay closed. */
  readonly close: () => void;
}

const DEFAULT_RETRY_MS = 500;
const DEFAULT_MAX_RETRY_MS = 15_000;
const DEFAULT_SILENCE_TOLERANCE = 3;

/** Events held out of order before the oldest is dropped. The bus's own bound:
 *  a client that buffered without limit would turn a lost packet into a leak. */
const MAX_PENDING = 512;

export function createEventStream(options: EventStreamOptions): EventStream {
  const handlers = new Map<TopicPattern, Set<EventHandler>>();
  const healthListeners = new Set<HealthListener>();
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer =
    options.clearTimeout ??
    ((handle: number) => {
      clearTimeout(handle as unknown as NodeJS.Timeout);
    });
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const tolerance = options.silenceTolerance ?? DEFAULT_SILENCE_TOLERANCE;

  let socket: SocketLike | null = null;
  let status: StreamStatus = 'idle';
  /** The newest sequence we have *contiguously* applied. Events beyond it are
   *  held, not delivered: a clip deleted before the move that preceded it is a
   *  timeline that never existed. */
  let lastSeq = 0;
  /** Events that arrived out of order, keyed by sequence, waiting for the
   *  replay that fills the hole. Bounded like the bus's own buffer. */
  const pending = new Map<number, EventEnvelope>();
  let awaitingResync = false;
  let repairTimer: number | undefined;
  let dropped = 0;
  let attempts = 0;
  let heartbeatSeconds = 15;
  let lastFrameAt = 0;
  let retryTimer: number | undefined;
  let watchdogTimer: number | undefined;
  let closedByUs = false;

  /** The published health. Rebuilt only inside `report`, so a caller that
   *  compares it by identity — React does exactly that — sees a change when and
   *  only when something changed. */
  let snapshot: StreamHealth = { status, lastSeq, dropped, attempts };

  function health(): StreamHealth {
    return snapshot;
  }

  function report(): void {
    // Nothing moved, nothing to say: a rebuilt snapshot with identical numbers
    // is a re-render in every consumer that compares it by identity.
    if (
      snapshot.status === status &&
      snapshot.lastSeq === lastSeq &&
      snapshot.dropped === dropped &&
      snapshot.attempts === attempts
    ) {
      return;
    }
    snapshot = { status, lastSeq, dropped, attempts };
    options.onHealth?.(snapshot);
    // Like `deliver`, one bad listener must not stop the rest: a status line
    // that throws is not an editor without a status line.
    for (const listener of [...healthListeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        options.onError?.(error);
      }
    }
  }

  function setStatus(next: StreamStatus): void {
    if (status === next) return;
    status = next;
    report();
  }

  // -- dispatch ------------------------------------------------------------

  function deliver(envelope: EventEnvelope): void {
    for (const [pattern, set] of handlers) {
      if (!matches(pattern, envelope.topic)) continue;
      for (const handler of [...set]) {
        try {
          handler(envelope);
        } catch (error) {
          // One handler's bug is not an editor-wide outage: report it and keep
          // delivering to everyone else.
          options.onError?.(error);
        }
      }
    }
  }

  /** Apply one event, sequence-checked.
   *
   *  Contiguous events go straight out. Anything ahead of the sequence is
   *  **held**, not delivered, and the hole is requested from the server: a
   *  `clip.deleted` that arrives before the `clip.moved` it follows is a
   *  timeline the user never had. Holding costs a map entry; delivering out of
   *  order costs a state nobody can reason about.
   */
  function applyEvent(envelope: EventEnvelope): void {
    if (envelope.seq <= lastSeq) return; // a replay's overlap, which is normal
    hold(envelope);
    drain();
    if (pending.size > 0 && !awaitingResync) requestRepair();
  }

  function hold(envelope: EventEnvelope): void {
    pending.set(envelope.seq, envelope);
    // Bounded the way the bus bounds its own buffer: drop the oldest, because
    // for a progress stream the newest position is the one that matters.
    while (pending.size > MAX_PENDING) {
      const oldest = pending.keys().next();
      if (oldest.done) break;
      pending.delete(oldest.value);
    }
  }

  /** Deliver everything that is now contiguous, in sequence order. */
  function drain(): void {
    let next = pending.get(lastSeq + 1);
    while (next !== undefined) {
      pending.delete(next.seq);
      lastSeq = next.seq;
      deliver(next);
      next = pending.get(lastSeq + 1);
    }
  }

  /** Ask the server for the hole, and set a deadline for the answer.
   *
   *  The deadline matters because a `resync` is a request the server is free to
   *  ignore — it answers only what it understands — and events held forever are
   *  worse than events delivered late.
   */
  function requestRepair(): void {
    awaitingResync = true;
    send({ type: 'resync', since: lastSeq });
    clearTimerIfSet(repairTimer);
    repairTimer = setTimer(
      () => {
        repairTimer = undefined;
        if (pending.size === 0) return;
        options.onStale?.('the service did not answer the replay request');
        flushPending();
      },
      heartbeatSeconds * 1000 * 2,
    );
  }

  /** Give up on the hole: deliver what we have, in order, and say so. */
  function flushPending(): void {
    awaitingResync = false;
    clearTimerIfSet(repairTimer);
    repairTimer = undefined;
    for (const seq of [...pending.keys()].sort((a, b) => a - b)) {
      const envelope = pending.get(seq);
      if (!envelope) continue;
      pending.delete(seq);
      lastSeq = seq;
      deliver(envelope);
    }
    report();
  }

  function send(frame: Parameters<typeof encodeFrame>[0]): void {
    if (!socket) return;
    try {
      socket.send(encodeFrame(frame));
    } catch {
      // A send on a closing socket is not an error worth surfacing: the close
      // handler is already on its way.
    }
  }

  // -- the socket's life ---------------------------------------------------

  function open(): void {
    if (socket || status === 'live' || closedByUs) return;
    if (retryTimer !== undefined) {
      clearTimer(retryTimer);
      retryTimer = undefined;
    }
    setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    lastFrameAt = now();
    let opened: SocketLike;
    try {
      opened = options.socketFactory(options.url);
    } catch (error) {
      options.onError?.(error);
      scheduleRetry();
      return;
    }
    socket = opened;
    opened.onopen = () => {
      // `hello` is what makes a stream live, not the open event: a socket that
      // opened and never said hello is a socket connected to the wrong thing.
      lastFrameAt = now();
    };
    opened.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      lastFrameAt = now();
      const frame = parseFrame(event.data);
      if (frame) {
        receive(frame);
        // After the frame, not inside it: the sequence it advanced belongs in
        // the health a listener reads next, whichever path it took.
        report();
      }
    };
    opened.onerror = () => {
      // No detail is available from a WebSocket error by design; the close
      // handler that follows carries what matters, which is that it happened.
      options.onError?.(new Error('the event socket reported an error'));
    };
    opened.onclose = () => {
      socket = null;
      clearTimerIfSet(watchdogTimer);
      watchdogTimer = undefined;
      if (closedByUs) {
        setStatus('idle');
        return;
      }
      scheduleRetry();
    };
  }

  function receive(frame: ServerFrame): void {
    switch (frame.type) {
      case 'hello': {
        heartbeatSeconds = frame.heartbeat_seconds > 0 ? frame.heartbeat_seconds : 15;
        attempts = 0;
        setStatus('live');
        // A sequence that went backwards means the service restarted: every
        // number we hold belongs to a session that no longer exists, so there
        // is nothing to resync — the caller refetches instead.
        if (frame.seq < lastSeq) {
          pending.clear();
          lastSeq = frame.seq;
          options.onStale?.('the service restarted');
        }
        lastSeq = Math.max(lastSeq, frame.seq);
        armWatchdog();
        report();
        return;
      }
      case 'event':
        applyEvent(frame);
        return;
      case 'heartbeat':
        dropped = frame.dropped;
        if (frame.seq > lastSeq) lastSeq = frame.seq;
        report();
        armWatchdog();
        return;
      case 'pong':
        armWatchdog();
        return;
      case 'resync': {
        awaitingResync = false;
        clearTimerIfSet(repairTimer);
        repairTimer = undefined;
        const before = lastSeq;
        for (const envelope of frame.events) {
          if (envelope.seq <= lastSeq) continue; // the overlap a replay brings
          hold(envelope);
        }
        drain();
        if (!frame.complete) {
          // History could not reach back far enough. Not an error to retry and
          // not something to hide: the caller refetches.
          options.onStale?.(
            frame.oldest_seq === null
              ? 'the service retains no event history'
              : `events before ${frame.oldest_seq} are gone`,
          );
          flushPending();
        } else if (pending.size > 0 && lastSeq === before) {
          // A complete replay that did not move us is a hole it could not see:
          // deliver what we hold rather than holding it forever.
          options.onStale?.('the replay did not cover the gap');
          flushPending();
        } else if (pending.size > 0) {
          requestRepair();
        }
        lastSeq = Math.max(lastSeq, frame.last_seq);
        report();
        return;
      }
      case 'goodbye':
        // The server closed its side. Nothing else will close ours, and a
        // socket left open is a connection we hold until our own timeout.
        socket?.close();
        return;
    }
  }

  /** A socket that has gone quiet is a socket that is gone: no frame arrives to
   *  tell us, so silence is the only evidence there is. */
  function armWatchdog(): void {
    clearTimerIfSet(watchdogTimer);
    watchdogTimer = setTimer(() => {
      if (closedByUs || !socket) return;
      const silentFor = now() - lastFrameAt;
      const allowed = heartbeatSeconds * tolerance * 1000;
      if (silentFor < allowed) {
        armWatchdog();
        return;
      }
      options.onError?.(new Error('the event socket went quiet; reconnecting'));
      try {
        socket.close();
      } catch {
        scheduleRetry();
      }
    }, heartbeatSeconds * 1000);
  }

  function clearTimerIfSet(handle: number | undefined): void {
    if (handle !== undefined) clearTimer(handle);
  }

  function scheduleRetry(): void {
    if (closedByUs) return;
    attempts += 1;
    setStatus('reconnecting');
    // The attempt count is part of the health even when the status word is not
    // new: a window that says "reconnecting" for an hour should be able to say
    // for how long.
    report();
    // Doubling with jitter: a service restarting gets a window to finish, and
    // a hundred windows do not all retry on the same millisecond.
    const ceiling = Math.min(maxRetryMs, retryMs * 2 ** (attempts - 1));
    const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
    retryTimer = setTimer(() => {
      retryTimer = undefined;
      open();
    }, delay);
  }

  function close(): void {
    closedByUs = true;
    clearTimerIfSet(retryTimer);
    retryTimer = undefined;
    clearTimerIfSet(watchdogTimer);
    watchdogTimer = undefined;
    clearTimerIfSet(repairTimer);
    repairTimer = undefined;
    pending.clear();
    awaitingResync = false;
    // Politely, and then firmly: `unsubscribe` tells the server we are done,
    // and the close is ours to do because the server's `goodbye` only comes
    // after a socket we may already have lost.
    send({ type: 'unsubscribe' });
    const doomed = socket;
    socket = null;
    try {
      doomed?.close();
    } catch {
      // Already gone, which is the outcome we wanted anyway.
    }
    setStatus('idle');
  }

  return {
    subscribe(pattern: TopicPattern, handler: EventHandler): () => void {
      const set = handlers.get(pattern) ?? new Set<EventHandler>();
      set.add(handler);
      handlers.set(pattern, set);
      return () => {
        set.delete(handler);
        if (set.size === 0) {
          handlers.delete(pattern);
        }
      };
    },
    onHealthChange(listener: HealthListener): () => void {
      healthListeners.add(listener);
      return () => {
        healthListeners.delete(listener);
      };
    },
    health,
    open,
    close,
  };
}

/** Whether a topic matches a pattern.
 *
 *  Prefix matching is the point: a panel that cares about the timeline
 *  subscribes to `timeline.*` and is not rewritten when a topic is added under
 *  it. Exact matches still work, and `*` is the whole stream.
 */
export function matches(pattern: TopicPattern, topic: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.endsWith('.*')) return pattern === topic;
  const prefix = pattern.slice(0, -1);
  return topic.startsWith(prefix);
}
